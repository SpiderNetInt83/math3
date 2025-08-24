
// You can write more code here

/* START OF COMPILED CODE */

/* START-USER-IMPORTS */
import Board from "../board/Board";
/* END-USER-IMPORTS */

export default class ArcadeMode extends Phaser.Scene {

	constructor() {
		super("ArcadeMode");

		/* START-USER-CTR-CODE */
		// Write your code here.
		/* END-USER-CTR-CODE */
	}

	editorCreate(): void {

		// forest
		this.add.image(360, 640, "forest");

		this.events.emit("scene-awake");
	}

	/* START-USER-CODE */

	private board?: Board;

	create() {

		this.editorCreate();

		// Создаём доску
		const cfg: BoardConfig = {
			rows: 6,
			cols: 6,
			colors: 4,       // или ['red','green','blue','yellow']
			marginX: 24,
			offsetYRatio: 0.11
		};

		this.board = new Board(this, cfg); // ← обязательно сохранить в поле
		this.board.create();  
	}

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here
