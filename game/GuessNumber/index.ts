import createPlugin from '../../src/types';
const content=`
**目标数字**是一个位于 1-99 范围内的整数。你可以随意输入任何一个数字，我会告诉你这个数字比目标大了还是小了，还是正好相同。

如果正好相同，那你就过关了。

你有 7 次机会来猜出数字；如果在 7 次之内都没有猜对，那么本关将进行重置。
`;
export default createPlugin({
  pid: 'GuessNumber',
  name: 'GuessNumber',
  label: '01',
  unlock: true,
  accessible: 'always',
  description: {
    before_solve: {
      content,
    },
  },
  scores: [
    { id: 'GuessNumber.in5times', desc: '只用 5 次就通过本关', points: 5 },
    { id: 'GuessNumber.in3times', desc: '只用 3 次就通过本关', points: 5 },
    { id: 'GuessNumber.inonce', desc: '只用 1 次就通过本关', points: 5 },
  ],
  checker:async(ans,ctx)=>{
    let inputTime=ctx.gameStorage.get<number>("GuessNumber.time")||0;
    const target=ctx.gameStorage.get<number>("GuessNumber.target")||Math.floor(99.9999*Math.random());
    const input=parseFloat(ans);
    inputTime++;
    ctx.gameStorage.set("GuessNumber.time",inputTime);
    if(Math.abs(input-target)<1e-5){
      ctx.msg(`对了`);
      if(inputTime <=5){
        ctx.award("GuessNumber.in5times");
        if(inputTime <=3){
          ctx.award("GuessNumber.in3times");
          if(inputTime===1){
            ctx.award("GuessNumber.inonce");
          }
        }
      }
      ctx.gameStorage.set("GuessNumber.time",0);
      ctx.gameStorage.set("GuessNumber.target",Math.floor(99.9999*Math.random()));
      ctx.msg(`题目已重置`);
      return true;
    }
    if(input <target){
      ctx.msg(`小了（次数：${inputTime}/7）`);
    }
    else if(input>target){
      ctx.msg(`大了（次数：${inputTime}/7）`);
    }
    if(inputTime>=7){
      ctx.gameStorage.set("GuessNumber.time",0);
      ctx.gameStorage.set("GuessNumber.target",Math.floor(99.9999*Math.random()));
      ctx.msg(`输入 7 次还未猜出，本轮作废。题目已重置`);
    }
    return false;
  },
  inputs:true,
});
