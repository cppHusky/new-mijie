import createPlugin from "../../src/types.ts";
const content=`
既然是公测，就不难为大家了：

1104787849
`;
export default createPlugin({
	pid:"QQGroup",
	name:"QQGroup",
	label:"11",
	unlock:[
		{
			type:"pass",
			pid:"BlockedCharacters",
		},
		{
			type:"points",
			atLeast:60,
		},
	],
	accessible:{
		rules:[{
			when:[{
				type:"pass",
				pid:"BlockedCharacters",
			}],
			then:"visible",
		}],
	},
	description:{
		before_solve:{
			content,
		},
	},
	inputs:false,
});
