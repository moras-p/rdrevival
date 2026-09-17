function parseAxisPart(text) {
  const raw=String(text ?? '').trim();
  const body=raw.startsWith('{') && raw.endsWith('}') ? raw.slice(1,-1) : raw;
  const values=[];
  for (const part0 of body.split(',')) {
    const part=part0.trim(); if (!part) continue;
    const range=part.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
    if (range) {
      let a=Number(range[1]), b=Number(range[2]); const step=a<=b?1:-1;
      for (let v=a;;v+=step) { values.push(v); if (v===b) break; }
    } else if (/^-?\d+$/.test(part)) values.push(Number(part));
    else throw new Error(`Invalid geometry axis selector: ${text}`);
  }
  return [...new Set(values)];
}

export function parseGeometryIdExpression(expression) {
  const raw=String(expression ?? '').trim().replace(/^['"]|['"]$/g,'');
  const match=raw.match(/^(MD\d{4})#geometry#(classic|rdx):(g\d+):(\{[^}]+\}|-?\d+):(\{[^}]+\}|-?\d+)$/);
  if (!match) throw new Error(`Invalid geometry ID expression: ${expression}`);
  return { mapName:match[1], mapId:Number(match[1].slice(2)), visualSource:match[2], grid:match[3], xs:parseAxisPart(match[4]), ys:parseAxisPart(match[5]) };
}

export function expandGeometryIdExpression(expression) {
  const p=parseGeometryIdExpression(expression), out=[];
  for (const x of p.xs) for (const y of p.ys) out.push(`${p.mapName}#geometry#${p.visualSource}:${p.grid}:${x}:${y}`);
  return out;
}

function axisText(values) {
  const sorted=[...new Set(values.map(Number))].sort((a,b)=>a-b);
  if (sorted.length===1) return String(sorted[0]);
  const runs=[]; let start=sorted[0], prev=sorted[0];
  const flush=()=>runs.push(start===prev?String(start):(prev===start+1?`${start}, ${prev}`:`${start}-${prev}`));
  for (let i=1;i<sorted.length;i++) { const v=sorted[i]; if (v===prev+1) { prev=v; continue; } flush(); start=prev=v; }
  flush();
  return `{${runs.join(', ')}}`;
}

export function compactGeometryIds(ids) {
  const groups=new Map();
  for (const id of ids || []) {
    const p=parseGeometryIdExpression(id);
    if (p.xs.length!==1 || p.ys.length!==1) {
      for (const expanded of expandGeometryIdExpression(id)) {
        const e=parseGeometryIdExpression(expanded), key=`${e.mapName}#geometry#${e.visualSource}:${e.grid}`;
        if (!groups.has(key)) groups.set(key, []); groups.get(key).push([e.xs[0],e.ys[0]]);
      }
    } else {
      const key=`${p.mapName}#geometry#${p.visualSource}:${p.grid}`;
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push([p.xs[0],p.ys[0]]);
    }
  }
  const out=[];
  for (const [prefix,pairs0] of groups) {
    const pairs=[...new Map(pairs0.map(p=>[`${p[0]}:${p[1]}`,p])).values()];
    const xs=[...new Set(pairs.map(p=>p[0]))].sort((a,b)=>a-b);
    const ys=[...new Set(pairs.map(p=>p[1]))].sort((a,b)=>a-b);
    if (pairs.length===xs.length*ys.length && xs.every(x=>ys.every(y=>pairs.some(p=>p[0]===x&&p[1]===y)))) {
      out.push(`${prefix}:${axisText(xs)}:${axisText(ys)}`);
      continue;
    }
    /* Group rows that share the same selected X set. */
    const byXs=new Map();
    for (const y of ys) {
      const rowXs=pairs.filter(p=>p[1]===y).map(p=>p[0]).sort((a,b)=>a-b);
      const sig=rowXs.join(','); if (!byXs.has(sig)) byXs.set(sig,{xs:rowXs,ys:[]}); byXs.get(sig).ys.push(y);
    }
    for (const row of byXs.values()) out.push(`${prefix}:${axisText(row.xs)}:${axisText(row.ys)}`);
  }
  return out;
}

export function geometryIdsClipboardText(ids) {
  const compact=compactGeometryIds(ids);
  return compact.length===1 ? JSON.stringify(compact[0]) : JSON.stringify(compact, null, 2);
}

export function expandGeometrySelectors(selectors) {
  const input=Array.isArray(selectors)?selectors:[selectors];
  return [...new Set(input.filter(Boolean).flatMap(expandGeometryIdExpression))];
}
