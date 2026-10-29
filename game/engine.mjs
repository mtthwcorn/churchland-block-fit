export const BLOCKS = Object.freeze([
  Object.freeze({id:'square', name:'Yellow square', color:'gold', width:2, height:2}),
  Object.freeze({id:'tall', name:'Green tall block', color:'green', width:1, height:2}),
  Object.freeze({id:'long', name:'Blue long block', color:'blue', width:3, height:1})
]);
export function newPuzzle(random = Math.random, previousLayout = -1) {
  const choices = [0,1,2,3].filter(value => value !== previousLayout);
  const layout = choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
  const top = layout < 2, left = layout % 2 === 0;
  const y = top ? 1 : 0;
  const slots = [
    {id:'square',x:left ? 0 : 1,y,width:2,height:2},
    {id:'tall',x:left ? 2 : 0,y,width:1,height:2},
    {id:'long',x:0,y:top ? 0 : 2,width:3,height:1}
  ];
  const order = BLOCKS.map(block => block.id);
  for (let i=order.length-1;i>0;i--) {
    const j=Math.min(i,Math.max(0,Math.floor(random()*(i+1))));
    [order[i],order[j]]=[order[j],order[i]];
  }
  return {layout,slots,order,placed:[]};
}
export function fitBlock(puzzle, pieceId, slotId) {
  if (!BLOCKS.some(block => block.id === pieceId) || pieceId !== slotId || puzzle.placed.includes(pieceId))
    return {accepted:false,puzzle,complete:puzzle.placed.length === BLOCKS.length};
  const next = {...puzzle,placed:[...puzzle.placed,pieceId]};
  return {accepted:true,puzzle:next,complete:next.placed.length === BLOCKS.length};
}
