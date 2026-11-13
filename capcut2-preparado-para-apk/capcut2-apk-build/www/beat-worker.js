// CapCut 2 — onset envelope/peak picker (runs off the UI thread).
self.onmessage = ({data}) => {
  const {id, envelope, rate, minGap=0.22} = data;
  const energy = new Float32Array(envelope);
  const beats = [];
  const radius = Math.max(4, Math.round(rate * .35));
  const gap = Math.max(1, Math.round(rate * minGap));
  let last = -gap;
  // Adaptive local baseline + positive change (transients), not simply loudness.
  const prefix = new Float64Array(energy.length + 1);
  for (let i=0; i<energy.length; i++) prefix[i+1]=prefix[i]+energy[i];
  const novelty = new Float32Array(energy.length);
  for (let i=2; i<energy.length-2; i++) {
    const lo=Math.max(0,i-radius), hi=Math.min(energy.length,i+radius);
    const avg=(prefix[hi]-prefix[lo])/(hi-lo);
    novelty[i]=Math.max(0,energy[i]-energy[i-2]) * (energy[i]/Math.max(.00002,avg));
  }
  let sorted=Array.from(novelty).filter(n=>n>0).sort((a,b)=>a-b);
  const threshold = sorted.length ? sorted[Math.floor(sorted.length*.72)]*.9 : Infinity;
  for (let i=2;i<novelty.length-2;i++) {
    if(i-last<gap || novelty[i]<threshold || novelty[i]<=novelty[i-1] || novelty[i]<novelty[i+1]) continue;
    let peak=i;
    // Keep the strongest onset in a minimum interval.
    for(let j=i+1;j<Math.min(i+gap,novelty.length);j++)if(novelty[j]>novelty[peak])peak=j;
    if(peak===i){ beats.push(i/rate);last=i; }
  }
  self.postMessage({id,beats});
};
