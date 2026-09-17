import {
  CollisionAvailability,
  CollisionPolicy,
  RdxCollisionDataset,
  collisionStatusText
} from './dataset.js';
import { projectCollisionGrid, projectDescriptorRoom } from '../core/map-topology.js';

export class RdxCollisionRuntime {
  constructor(bridge, dataset, mapping, mapDecoder, roomManifest) {
    if (!(dataset instanceof RdxCollisionDataset)) throw new TypeError('RdxCollisionDataset required');
    this.bridge = bridge;
    this.dataset = dataset;
    this.mapping = mapping;
    this.mapDecoder = mapDecoder;
    this.roomManifest = new Map((roomManifest?.rooms || []).map(room => [Number(room.mapId), room]));
    this.policy = CollisionPolicy.RDX_VERIFIED;
    this.activeKey = '';
    this.activeRoom = null;
  }

  setPolicy(policy) {
    this.policy = Number(policy);
    this.bridge.setCollisionPolicy(this.policy);
  }

  activate(snapshot) {
    /* A requestAnimationFrame snapshot can become stale when the C core
     * completes a room transition before this UI pass reaches collision
     * activation. Never reinstall the source room over the destination world:
     * MD0005 -> MD0006 exposed this as a timing-dependent empty room until the
     * user pressed Reset current level. Leave activeKey empty so the next live
     * destination snapshot retries normally. */
    const liveSubmap = typeof this.bridge.submap === 'function'
      ? (Number(this.bridge.submap()) >>> 0)
      : (Number(snapshot.submap) >>> 0);
    if (liveSubmap !== (Number(snapshot.submap) >>> 0)) {
      this.activeKey = '';
      this.activeRoom = null;
      return null;
    }
    const level = this.mapping.levelForSubmap(snapshot.submap);
    if (!level) {
      this.bridge.resetCollision();
      this.activeKey = `missing:${snapshot.submap}`;
      this.activeRoom = null;
      return null;
    }
    const rawRoom = this.dataset.roomForMap(level.rdxMd);
    const topology = level.rdxTopology || null;
    const room = projectCollisionGrid(rawRoom, topology);
    const key = `${snapshot.submap}:${level.rdxMd}:${this.dataset.datasetHash}`;
    if (key === this.activeKey) {
      /* activeKey is only a JS-side cache hint. The C core can cold-reset or
       * replace its descriptor world while the selected room key remains unchanged
       * (Reset, deterministic AI restart, frontend transitions). Never trust a
       * stale cache over the authoritative WASM collision state. */
      const descriptor = snapshot.collision?.native;
      const descriptorStillInstalled = !!descriptor?.worldLoaded &&
        (Number(descriptor.mapId) >>> 0) === (Number(level.rdxMd) >>> 0);
      if (descriptorStillInstalled) return room;
      this.activeKey = '';
      this.activeRoom = null;
    }
    if (!room) {
      this.activeKey = key;
      this.activeRoom = null;
      this.bridge.resetCollision();
      return null;
    }
    const runtimeOffset = typeof this.mapping.runtimeOffsetForSubmap === 'function'
      ? this.mapping.runtimeOffsetForSubmap(snapshot.submap)
      : {
          dxPx: level.pixelOffset.dxPx + Number(level.runtimeViewportBias?.dxPx || 0),
          dyPx: level.pixelOffset.dyPx + Number(level.runtimeViewportBias?.dyPx || 0)
        };
    this.bridge.loadCollisionRoom({
      submap: snapshot.submap,
      mapId: level.rdxMd,
      baseDxPx: runtimeOffset.dxPx,
      baseDyPx: runtimeOffset.dyPx,
      room,
      datasetHash: this.dataset.datasetHash
    });

    const rawDimensions = this.mapDecoder.dimensions(level.rdxMd);
    const rawLogic = this.mapDecoder.logicDimensions(level.rdxMd);
    const rawMt = this.mapDecoder.rom.payload('MT', level.rdxMd);
    const mlAsset = this.mapDecoder.rom.getAsset('ML', level.rdxMd);
    const rawMl = mlAsset ? this.mapDecoder.rom.payload('ML', level.rdxMd) : new Uint8Array(rawMt.length);
    const projected = projectDescriptorRoom({ dimensions:rawDimensions, logic:rawLogic, mt:rawMt, ml:rawMl }, topology);
    const { dimensions, logic, mt, ml } = projected;
    /* Descriptor capability metadata is generated from the same v27 room
     * manifest as the C mapping table. The world is loaded for every mapped
     * room; nativeReady now describes descriptor completeness for diagnostics
     * and strict mode, not selection of a second Rick movement solver. */
    const roomCapability = this.roomManifest.get(Number(level.rdxMd));
    const capabilityMask = Number(roomCapability?.capabilityMask || 0) >>> 0;
    const nativeReady = !!roomCapability?.nativeReady;
    this.bridge.loadNativeCollisionRoom({
      submap: snapshot.submap,
      mapId: level.rdxMd,
      baseDxPx: runtimeOffset.dxPx,
      baseDyPx: runtimeOffset.dyPx,
      dimensions,
      logic,
      mt,
      ml,
      capabilityMask,
      nativeReady
    });
    this.activeKey = key;
    this.activeRoom = room;
    return room;
  }

  status(snapshot) {
    const level = this.mapping.levelForSubmap(snapshot.submap);
    const mapId = level?.rdxMd ?? 0xffff;
    const room = level ? this.dataset.roomForMap(mapId) : null;
    return collisionStatusText({
      enabled: snapshot.enabled,
      policy: this.policy,
      room,
      submap: snapshot.submap,
      mapId,
      datasetVersion: this.dataset.version,
      runtime: snapshot.collision
    });
  }
}

export { CollisionAvailability, CollisionPolicy };
