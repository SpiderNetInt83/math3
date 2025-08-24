import Phaser from 'phaser';
import { GRID } from '../constants';

interface BoardConfig {
	rows?: number;
	cols?: number;
    colors?: number;
}

export default class Board {
	private scene: Phaser.Scene;
	private rows: number;
	private cols: number;
	private cellSize: number;
    private gems: string[];

	private readonly allGems  = ['red', 'blue', 'green', 'yellow', 'purple'];

	constructor(scene: Phaser.Scene, config: BoardConfig = {}) {
		this.scene = scene;
		this.rows = config.rows ?? GRID.rows;
		this.cols = config.cols ?? GRID.cols;

        // ограничиваем количество цветов
		const colorCount = config.colors ?? this.allGems.length;
		this.gems = this.allGems.slice(0, colorCount);

        const screenWidth = this.scene.cameras.main.width;

		// Отступы по 20px
		const margin = 24;
		// Доступная ширина = ширина экрана - левый и правый отступ
		const availableWidth = screenWidth - margin * 2;
		// Размер ячейки = доступная ширина / количество колонок
		this.cellSize = Math.floor(availableWidth / this.cols);
	}

	createBoard(): void {
		const screenWidth = this.scene.cameras.main.width;
        const offsetTop = 300;

		// Общая ширина доски
		const boardWidth = this.cols * this.cellSize;

        console.log("Общая ширина доски: ", boardWidth)

		// Смещение по X, чтобы доска была по центру
		const offsetX = (screenWidth - boardWidth) / 2;

		for (let row = 0; row < this.rows; row++) {
			for (let col = 0; col < this.cols; col++) {
				const x = offsetX + col * this.cellSize + this.cellSize / 2;
				const y = row * this.cellSize + this.cellSize / 2 + offsetTop; // отступ сверху

				const key = Phaser.Utils.Array.GetRandom(this.gems);
				const gem = this.scene.add.image(x, y, key);
				gem.setDisplaySize(this.cellSize, this.cellSize);
			}
		}
	}
}
