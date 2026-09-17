export class SoundLabAuthoringClient {
  constructor(base) { if(!base)throw new Error('SoundLab authoring service base is required'); this.base = new URL(base, document.baseURI); this.capabilities = null; }
  url(path) { return new URL(String(path).replace(/^\//,''), this.base); }
  async request(path,{method='GET',body=null}={}) {
    const response=await fetch(this.url(path),{method,cache:'no-store',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
    const value=await response.json().catch(()=>({error:`HTTP ${response.status}`}));
    if(!response.ok)throw new Error(value.error||`SoundLab authoring service failed (${response.status})`);
    return value;
  }
  async connect(){this.capabilities=await this.request('capabilities');return this.capabilities;}
  status(){return this.request('status');}
  sources(){return this.request('sources');}
  render(job){return this.request('render',{method:'POST',body:job});}
  batch(job){return this.request('batch',{method:'POST',body:job});}
  promote(job){return this.request('promote',{method:'POST',body:job});}
  importSource(source){return this.request('import-source',{method:'POST',body:source});}
}
