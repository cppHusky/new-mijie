import createPlugin from "../../src/types.ts";
export default createPlugin({
	pid:"Shirt",
	name:"Shirt",
	label:"05",
	description:{
		before_solve:{
			content:"How much is the shirt in pounds?",
		},
		after_solve:{
			content:"Yes, it's nine fifteen.",
		},
	},
	unlock:[
		{
			type:"passCount",
			pids:[
				"ISBN",
				"Dialling",
				"Calculate",
			],
			count:2,
			desc:(ctx,nameOf)=>{
				const showName=(pid:string)=>pid==="Calculate"?"Calculate":nameOf(pid);
				const condition=ctx.passed.has("Dialling")||ctx.passed.has("ISBN");
				const names=[
					"ISBN",
					"Dialling",
					"Calculate",
				].map(condition?showName:nameOf).join("》《");
				return `在《${names}》中通过任意 2 关`;
			},
		},
	],
	accessible:(ctx)=>{
		if(ctx.unlocked)
			return "visible";
		if(ctx.met({type:"points",atLeast:15})||ctx.met({type:"pass",pid:"CountLightsOut"}))
			return "ghost";
		return "hidden";
	},
	inputs:true,
	scores:[{
			id:"Shirt.inputPence",
			desc:"不审题",
			points:-5,
			when:async(ans,_)=>parseFloat(ans)==915,
			renotify:true,
	}],
	captcha:true,
	record:true,
	checker:async(ans,_)=>parseFloat(ans)===9.15,
	files:[
		{
			filename:"audio.mp3",
		},
	],
});
