function rowFor(catalog, entityN) {
  return (catalog?.entities || []).find(row => Number(row.entity) === Number(entityN)) || null;
}

export function entityTypeOptionLabel(row) {
  if (!row) return 'Unknown native entity';
  const pn=Number(row.pn), options=(row.pnOptions || []).map(Number).filter(v=>Number.isFinite(v)&&v>=0&&v!==pn);
  return `${row.hex} · ${row.name} · ${row.category}${pn >= 0 ? ` · default PN ${pn}${options.length?` · alternatives PN ${options.join('/')}`:''}` : ' · no mapped PN'}`;
}

export function entityAssignmentSummary(entity, catalog) {
  const row=rowFor(catalog,entity?.entity);
  if (!row) return {row:null,behavior:'Unknown native behavior',category:String(entity?.category||'actor'),mappedPn:null,currentPn:Number(entity?.pn),presentationStatus:'No catalog mapping'};
  const mappedPn=Number(row.pn) >= 0 ? Number(row.pn) : null;
  const currentPn=Number(entity?.pn);
  const validPns=new Set([mappedPn,...(row.pnOptions || []).map(Number)].filter(v=>v!=null&&Number.isFinite(v)&&v>=0));
  return {
    row,
    behavior:`${row.hex} · ${row.name}`,
    category:String(row.category || entity?.category || 'actor'),
    mappedPn,
    currentPn,
    presentationStatus:mappedPn == null ? 'No mapped Revival sprite' : (currentPn === mappedPn ? `Default mapped PN ${mappedPn}` : (validPns.has(currentPn) ? `Mapped alternate PN ${currentPn} · default PN ${mappedPn}` : `Current PN ${currentPn >= 0 ? currentPn : 'native'} · default PN ${mappedPn}`)),
    description:String(row.description || '')
  };
}

function automaticName(name, oldRow) {
  const value=String(name || '');
  return !value || value === String(oldRow?.name || '') || /^Entity 0x[0-9a-f]+$/i.test(value) || /^Mark \d+$/i.test(value);
}

function mappedPresentation(entity, row) {
  if (!row) return Number(entity?.pn) < 0;
  const pn=Number(entity?.pn);
  const options=(row.pnOptions || []).map(Number);
  return pn === Number(row.pn) || options.includes(pn) || pn < 0;
}

export function assignNativeEntityType(entity, nextEntityN, catalog) {
  if (!entity) return null;
  const oldRow=rowFor(catalog,entity.entity), nextRow=rowFor(catalog,nextEntityN);
  const rename=automaticName(entity.name,oldRow), remap=mappedPresentation(entity,oldRow);
  const oldPn=Number(entity.pn);
  entity.entity=Number(nextEntityN);
  if (nextRow) {
    entity.category=nextRow.category || entity.category;
    if (rename) entity.name=nextRow.name;
    const nextPns=new Set([Number(nextRow.pn),...(nextRow.pnOptions || []).map(Number)].filter(v=>Number.isFinite(v)&&v>=0));
    if (remap && Number(nextRow.pn) >= 0 && !nextPns.has(oldPn)) {
      entity.pn=Number(nextRow.pn);
      entity.frameIndex=-1;
    }
  }
  return {oldRow,nextRow,renamed:rename && !!nextRow,remappedPn:remap && !!nextRow && Number(entity.pn)!==oldPn,oldPn,newPn:Number(entity.pn)};
}
