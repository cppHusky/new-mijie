import createPlugin from "../../src/types";
const normalize=(str:string)=>str.replace(/\s+/g," ").trim().toLowerCase();
const origin:string=`
I met a traveller from an antique land
Who said: Two vast and trunkless legs of stone
Stand in the desert. Near them, on the sand,
Half sunk, a shattered visage lies, whose frown,
And wrinkled lip, and sneer of cold command,
Tell that its sculptor well those passions read
Which yet survive, stamped on these lifeless things,
The hand that mocked them and the heart that fed:
And on the pedestal these words appear:
"My name is Ozymandias, king of kings:
Look on my works, ye Mighty, and despair!"
Nothing beside remains. Round the decay
Of that colossal wreck, boundless and bare
The lone and level sands stretch far away.
`;
const blockCharacters=(str:string,blockIndex:Set<0|1|2|3>)=>{
	let res="";
	let idx=0;
	for(const char of str){
		if(char.match(/^[a-z]$/i)){
			if(blockIndex.has(idx%4))
				res=res.concat("*");
			else
				res=res.concat(char);
			idx++;
		}
		else
			res=res.concat(char);
	}
	return res;
};
export default createPlugin({
	pid:"BlockedCharacters",
	name:"BlockedCharacters",
	label:"10",
	unlock:[{
		type:"pass",
		pid:"Shirt",
	}],
	accessible:{
		rules:[{
			when:[{
				type:"pass",
				pid:"Shirt",
			}],
			then:"visible",
		}],
	},
	description:{
		before_solve:{
			mdv:{
				main:"app/main.md",
				include:["app/**/*"],
			},
		},
	},
	scores:[{
		id:"BlockedCharacters.incomplete",
		desc:"在未得到完整内容时，就通过了本关",
		when:(ans,ctx,info)=>{
			const water=ctx.gameProcess.passed.has("Water");
			const fire=ctx.gameProcess.passed.has("Fire");
			const wind=ctx.gameProcess.passed.has("Wind");
			const earth=ctx.gameProcess.passed.has("Earth");
			return info.passed&&!(water&&fire&&wind&&earth);
		},
		points:10,
	}],
	inputs:true,
	checker:async(ans,ctx)=>{
		const water=ctx.gameProcess.passed.has("Water")?1:0;
		const fire=ctx.gameProcess.passed.has("Fire")?1:0;
		const wind=ctx.gameProcess.passed.has("Wind")?1:0;
		const earth=ctx.gameProcess.passed.has("Earth")?1:0;
		const total=water+fire+wind+earth;
		const passed=normalize(ans)===normalize(origin);
		if(total <=3&&passed)
			ctx.msg(`你在只得到 ${total}/4 的内容时，就成功复现出了原文！`);
		return passed;
	},
	captcha:true,
	record:true,
	server:(app)=>{
		app.on("refresh",(_,ctx)=>{
			const water=ctx.gameProcess.passed.has("Water");
			const fire=ctx.gameProcess.passed.has("Fire");
			const wind=ctx.gameProcess.passed.has("Wind");
			const earth=ctx.gameProcess.passed.has("Earth");
			const set=new Set();
			[water,fire,wind,earth].forEach((ele,idx)=>{
				if(!ele)
					set.add(idx);
			});
			return blockCharacters(origin,set);
		});
	},
});
