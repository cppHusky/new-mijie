import createPlugin from "../../src/types.ts";
const content=`7 - 5404 - 7831 - 4`;
export default createPlugin({
	pid:"ISBN",
	name:"ISBN",
	label:"03",
	unlock:[
		{
			type:"points",
			atLeast:15,
		},
	],
	accessible:"suspended",
	description:{
		before_solve:{
			content,
		},
	},
	scores:[
		{
			id:"ISBN.inputFullname",
			desc:"不审题",
			points:-5,
			when:async(ans,_)=>ans.x.trim()==="长安十二时辰",
		},
	],
	inputs:[
		{name:"x",placeholder:"地名"},
	],
	captcha:true,
	record:true,
	checker:async(ans,_)=>ans.x.trim()==="长安",
});
