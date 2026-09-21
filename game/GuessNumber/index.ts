import createPlugin from '../../src/types';
const resetTarget=(ctx)=>{
	ctx.gameStorage.set("GuessNumber.time",0);
	ctx.gameStorage.set("GuessNumber.target",1+Math.floor(98.9999*Math.random()));
};
export default createPlugin({
	pid: 'GuessNumber',
	name: 'GuessNumber',
	label: '01',
	unlock: true,
	accessible: 'always',
	description: {
		before_solve: {
			mdv:{
				main:"main.md",
				include:["main.md"],
			},
		},
		admin:{
			main:"admin.vue",
			include:["admin.vue"],
		},
	},
	scores: [
		{ id: 'GuessNumber.in5times', desc: '只用 5 次就通过本关', points: 5 },
		{ id: 'GuessNumber.in3times', desc: '只用 3 次就通过本关', points: 5 },
		{ id: 'GuessNumber.inonce', desc: '只用 1 次就通过本关', points: 5 },
	],
	checker:async(ans,ctx)=>{
		let inputTime=ctx.gameStorage.get<number>("GuessNumber.time");
		let target=ctx.gameStorage.get<number>("GuessNumber.target");
		const input=parseFloat(ans);
		inputTime++;
		ctx.gameStorage.set("GuessNumber.time",inputTime);
		if(Math.abs(input-target)<1e-5){
			ctx.msg(`对了，用时 ${inputTime} 回合`);
			if(inputTime <=5){
				ctx.award("GuessNumber.in5times");
				if(inputTime <=3){
					ctx.award("GuessNumber.in3times");
					if(inputTime===1){
						ctx.award("GuessNumber.inonce");
					}
				}
			}
			resetTarget(ctx);
			ctx.msg(`题目已重置`);
			return true;
		}
		else if(input <target){
			ctx.msg(`小了（次数：${inputTime}/7）`);
		}
		else if(input>target){
			ctx.msg(`大了（次数：${inputTime}/7）`);
		}
		if(inputTime>=7){
			resetTarget(ctx);
			ctx.msg(`输入 7 次还未猜出，本轮作废。题目已重置`);
		}
		return false;
	},
	server:(app)=>{
		app.on("init_if_not_defined",(_,ctx)=>{
			let target=ctx.gameStorage.get<number>("GuessNumber.target");
			if(!target)
				resetTarget(ctx);
		});
		app.adminOn("get",(_,ctx)=>{
			return ctx.gameStorage.get<number>("GuessNumber.target");
		});
	},
	captcha:true,
	record:true,
	inputs:true,
});
