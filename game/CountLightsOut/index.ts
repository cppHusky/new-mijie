import createPlugin from "../../src/types";
export default createPlugin({
	pid:"CountLightsOut",
	name:"CountLightsOut",
	label:"02",
	unlock:[
		{
			type:"pass",
			pid:"GuessNumber",
		},
	],
	accessible:"suspended",
	description:{
		before_solve:{
			mdv:{
				main:"app/main.md",
				include:["app/**/*"],
			},
		},
	},
	scores:[
		{id:"CountLightsOut.allOn",desc:"把所有灯打开",points:15},
	],
	inputs:false,
	server:(app)=>{
		app.on('init', (_, ctx) => {
			const cells = Array.from({ length: 9 }, () => Math.random() > 0.5)
			ctx.gameStorage.set("cells", cells)
			if(cells.every(x=>x)){
				ctx.award("CountLightsOut.allOn")
			}
			return cells.reduce((acc, cur) => acc + (cur ? 1 : 0), 0)
		})
		app.on('toggle', (index: number, ctx) => {
			const cells = ctx.gameStorage.get<Array<boolean>>("cells")
			if (!cells) return
			const row = Math.floor(index / 3), col = index % 3;
			[
				[row, col], [row - 1, col],
				[row + 1, col],
				[row, col - 1],
				[row, col + 1],
			].forEach(([r, c]) => {
				if (r >= 0 && r < 3 && c >= 0 && c < 3) {
					cells[r * 3 + c] = !cells[r * 3 + c]
				}
			})
			ctx.gameStorage.set("cells", cells)
			if (cells.every(x => !x)) {
				ctx.pass()
			}
			if(cells.every(x=>x)){
				ctx.award("CountLightsOut.allOn")
			}
			return cells.reduce((acc, cur) => acc + (cur ? 1 : 0), 0)
		})
	},
});
