const choiceName = choice => typeof choice === 'string' ? choice : choice?.name;
const NEVER_SUPPRESS = new Set(['wait']);

function boundedOutcome(action,outcome={}) {
  return Object.freeze({
    action:String(action || 'wait'),
    dx:Number(outcome.dx || 0),dy:Number(outcome.dy || 0),
    blocked:!!outcome.blocked,landed:!!outcome.landed,death:!!outcome.death,transition:!!outcome.transition,
    bulletsUsed:Math.max(0,Number(outcome.bulletsUsed || 0)),dynamiteUsed:Math.max(0,Number(outcome.dynamiteUsed || 0))
  });
}

export class RealtimeLoopMemory {
  constructor({failureThreshold=2,suppressionDecisions=3,historyLimit=4,minProgressPx=1}={}) {
    this.failureThreshold=Math.max(1,failureThreshold|0);
    this.suppressionDecisions=Math.max(1,suppressionDecisions|0);
    this.historyLimit=Math.max(1,historyLimit|0);
    this.minProgressPx=Math.max(0,Number(minProgressPx)||0);
    this.decisionSerial=0; this.failures=new Map(); this.suppressedUntil=new Map(); this.recent=[];
    this.roomGeneration=null; this.lifeGeneration=null;
  }
  reset({history=true,generations=true}={}) {
    this.failures.clear(); this.suppressedUntil.clear();
    if(history)this.recent.length=0;
    if(generations){this.roomGeneration=null;this.lifeGeneration=null;this.decisionSerial=0;}
  }
  #resetFailures(){this.failures.clear();this.suppressedUntil.clear();}
  observe(observation) {
    const room=observation?.episode?.roomGeneration ?? null;
    const life=observation?.episode?.lifeGeneration ?? null;
    if(this.roomGeneration!==null && (room!==this.roomGeneration || life!==this.lifeGeneration)) this.reset({history:true,generations:false});
    this.roomGeneration=room; this.lifeGeneration=life;
  }
  offerChoices(choices) {
    const source=[...(choices||[])];
    this.decisionSerial+=1;
    for(const [name,until] of this.suppressedUntil) if(until<this.decisionSerial)this.suppressedUntil.delete(name);
    const filtered=source.filter(choice=>!this.suppressedUntil.has(choiceName(choice)));
    return filtered.length ? filtered : source;
  }
  recordOutcome(action,outcome={}) {
    const row=boundedOutcome(action,outcome);
    if(row.death || row.transition) {
      this.reset({history:true,generations:false});
      return row;
    }
    this.recent.push(row); if(this.recent.length>this.historyLimit)this.recent.shift();
    const progress=Math.abs(row.dx)+Math.abs(row.dy)>=this.minProgressPx || row.bulletsUsed>0 || row.dynamiteUsed>0;
    if(progress) { this.#resetFailures(); return row; }
    if(NEVER_SUPPRESS.has(row.action)) return row;
    const failures=(this.failures.get(row.action)||0)+1;
    this.failures.set(row.action,failures);
    if(failures>=this.failureThreshold) this.suppressedUntil.set(row.action,this.decisionSerial+this.suppressionDecisions);
    return row;
  }
  snapshot() {
    const suppressedActions=[...this.suppressedUntil.entries()]
      .filter(([,until])=>until>=this.decisionSerial)
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([action,untilDecision])=>Object.freeze({action,remainingDecisions:Math.max(0,untilDecision-this.decisionSerial)}));
    return Object.freeze({decisionSerial:this.decisionSerial,recentOutcomes:Object.freeze([...this.recent]),suppressedActions:Object.freeze(suppressedActions)});
  }
}

export function createRealtimeLoopMemory(options){return new RealtimeLoopMemory(options);}
