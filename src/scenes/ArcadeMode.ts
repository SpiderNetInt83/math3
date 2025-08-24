
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
		this.board = new Board(this, { rows: 6, cols: 6, colors: 3 });
		this.board.createBoard(); // ← тут обязательно скобки
	}

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here
