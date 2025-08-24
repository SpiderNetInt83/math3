
// You can write more code here

/* START OF COMPILED CODE */

/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

export default class Start extends Phaser.Scene {

	constructor() {
		super("Start");

		/* START-USER-CTR-CODE */
		// Write your code here.
		/* END-USER-CTR-CODE */
	}

	editorCreate(): void {

		// background
		this.add.image(360, 640, "background");

		this.events.emit("scene-awake");
	}

	/* START-USER-CODE */

	// Write your code here

	create() {

		this.editorCreate();

		// Добавляем логотип
		const logo = this.add.image(this.cameras.main.centerX-15, 250, 'GameLogo');
		logo.setOrigin(0.5);
		logo.setScale(0); // появится из нуля
		logo.setAlpha(0); // и станет видимым постепенно

		// Плавное появление и "подпрыгивание"
		this.tweens.add({
			targets: logo,
			alpha: 1,
			scale: { from: 0, to: 0.75 },
			ease: 'Back.Out',
			duration: 1800,
			onComplete: () => {
				// Постоянное лёгкое подпрыгивание
				this.tweens.add({
					targets: logo,
					y: '+=10',
					yoyo: true,
					repeat: -1,
					ease: 'Sine.easeInOut',
					duration: 1000
				});
			}
		});

		// Кнопка старт
		const startBtn = this.add.image(this.cameras.main.centerX, 500, 'ButtonStart');
		startBtn.setOrigin(0.5);
		startBtn.setInteractive({ useHandCursor: true });
		startBtn.setScale(0.25);

		// Эффект "дрожания" при наведении
		startBtn.on('pointerover', () => {
			this.tweens.add({
				targets: startBtn,
				x: { from: startBtn.x - 2, to: startBtn.x + 2 },
				duration: 50,
				repeat: -1,
				yoyo: true,
				ease: 'Sine.easeInOut'
			});
		});

		startBtn.on('pointerout', () => {
			this.tweens.killTweensOf(startBtn);
			startBtn.x = this.cameras.main.centerX; // сбросить
		});

		// Клик по кнопке — запуск новой сцены (назови нужную)
		startBtn.on('pointerdown', () => {
			this.scene.start('ArcadeMode'); // ← замени на свою игровую сцену
		});
	}

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here
