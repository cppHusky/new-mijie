import createPlugin from "../../src/types.ts";
const content=`MUALEECRISGEFJBWLVKG`;
export default createPlugin({
	pid:"Dialling",
	name:"Dialling",
	label:"04",
	unlock:[
		{
			type:"pass",
			pid:"CountLightsOut",
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
			id:"Dialling.CN",
			desc:"CN",
			points:5,
			when:async(ans,_)=>parseFloat(ans)===86,
		},
		{
			id:"Dialling.JPUS",
			desc:"JPUS",
			points:5,
			when:async(ans,_)=>parseFloat(ans)===82,
		},
	],
	inputs:true,
	checker:async(ans,_)=>parseFloat(ans)===5125,
});
