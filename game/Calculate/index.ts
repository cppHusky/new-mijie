import createPlugin from "../../src/types.ts";
export default createPlugin({
	pid:"Calculate",
	name:"Calculate",
	label:"03.5",
	unlock:true,
	accessible:"lurking",
	description:{
		before_solve:{
			md:"app/main.md",
		},
	},
	scores:[
		{
			id:"Calculate.robot",
			desc:"You are ROBOT?",
			points:5,
			when:async(ans,_)=>ans.trim()==="0.30000000000000004",
			renotify:true,
		},
	],
	inputs:true,
	captcha:true,
	record:true,
	checker:async(ans,_)=>ans.trim()==="0.3",
});
