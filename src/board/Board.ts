import Phaser from 'phaser';
import { GRID } from '../constants';

// ===== Константы =====
const ANIM_DURATION = 600;           // падение при создании
const ANIM_ROW_DELAY = 100;
const ANIM_COL_DELAY = 30;
const ANIM_EASE = 'Bounce.Out';

const SWAP_DURATION = 180;           // анимация обмена
const SWAP_EASE = 'Sine.easeInOut';

const HIGHLIGHT_SCALE = 1.06;        // увеличение выбранной фишки (через displayWidth/Height)

interface BoardConfig {
  rows?: number;
  cols?: number;
  colors?: number;      // количество используемых цветов (берём первые N)
  offsetTop?: number;   // вертикальный отступ поля
  marginX?: number;     // отступы слева/справа
}

interface GemCell {
  row: number;
  col: number;
  key: string;                      // ключ текстуры (red/blue/...)
  sprite: Phaser.GameObjects.Image; // отображаемый спрайт
}

export default class Board {
  private scene: Phaser.Scene;
  private rows: number;
  private cols: number;
  private cellSize: number;
  private gems: string[];

  private readonly allGems = ['red', 'blue', 'green', 'yellow', 'purple'];

  private readonly offsetTop: number;
  private readonly marginX: number;
  private offsetX = 0; // рассчитывается из ширины экрана

  private grid: GemCell[][] = [];

  // выбор для клика: первый и второй
  private selected?: GemCell;

  constructor(scene: Phaser.Scene, config: BoardConfig = {}) {
    this.scene = scene;
    this.rows = config.rows ?? GRID.rows;
    this.cols = config.cols ?? GRID.cols;

    const colorCount = Math.min(config.colors ?? this.allGems.length, this.allGems.length);
    this.gems = this.allGems.slice(0, Math.max(1, colorCount));

    this.offsetTop = config.offsetTop ?? 300;
    this.marginX = config.marginX ?? 24;

    const screenWidth = this.scene.cameras.main.width;
    const availableWidth = screenWidth - this.marginX * 2;
    this.cellSize = Math.floor(availableWidth / this.cols);

    this.offsetX = (screenWidth - this.cols * this.cellSize) / 2; // центрирование
  }

  // ===== utils =====
  private cellCenter(r: number, c: number): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(
      this.offsetX + c * this.cellSize + this.cellSize / 2,
      this.offsetTop + r * this.cellSize + this.cellSize / 2
    );
  }

  private worldToCell(x: number, y: number): { r: number; c: number } | null {
    const c = Math.floor((x - this.offsetX) / this.cellSize);
    const r = Math.floor((y - this.offsetTop) / this.cellSize);
    if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return null;
    return { r, c };
  }

  private pickGemAvoidingMatches(r: number, c: number): string {
    const forbidden = new Set<string>();
    if (c >= 2) {
      const a = this.grid[r][c - 1]?.key;
      const b = this.grid[r][c - 2]?.key;
      if (a && a === b) forbidden.add(a);
    }
    if (r >= 2) {
      const a = this.grid[r - 1]?.[c]?.key;
      const b = this.grid[r - 2]?.[c]?.key;
      if (a && a === b) forbidden.add(a);
    }
    const candidates = this.gems.filter(g => !forbidden.has(g));
    const pool = candidates.length ? candidates : this.gems;
    return Phaser.Utils.Array.GetRandom(pool);
  }

  private highlightOn(spr: Phaser.GameObjects.Image) {
    this.scene.tweens.killTweensOf(spr);
    this.scene.tweens.add({
      targets: spr,
      displayWidth: this.cellSize * HIGHLIGHT_SCALE,
      displayHeight: this.cellSize * HIGHLIGHT_SCALE,
      duration: 90,
      ease: 'Sine.easeOut'
    });
    spr.setDepth(10);
  }

  private highlightOff(spr: Phaser.GameObjects.Image) {
    this.scene.tweens.killTweensOf(spr);
    this.scene.tweens.add({
      targets: spr,
      displayWidth: this.cellSize,
      displayHeight: this.cellSize,
      duration: 90,
      ease: 'Sine.easeOut',
      onComplete: () => spr.setDepth(0)
    });
  }

  // ===== публичное API =====
  createBoard(): void {
    // инициализация сетки
    this.grid = new Array(this.rows)
      .fill(null)
      .map((_, r) => new Array(this.cols).fill(null).map((__, c) => ({ row: r, col: c, key: '', sprite: null as any })));

    // создать поле с анимацией падения
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const key = this.pickGemAvoidingMatches(r, c);
        const pos = this.cellCenter(r, c);
        const spr = this.scene.add.image(pos.x, -this.cellSize, key);
        spr.setDisplaySize(this.cellSize, this.cellSize);

        this.grid[r][c] = { row: r, col: c, key, sprite: spr };

        this.scene.tweens.add({
          targets: spr,
          y: pos.y,
          ease: ANIM_EASE,
          duration: ANIM_DURATION,
          delay: r * ANIM_ROW_DELAY + c * ANIM_COL_DELAY,
          onComplete: () => {
            // this.scene.sound.play('boardCreate'); // если нужно по каждой фишке
          }
        });
      }
    }

    this.enableClickSwap();
  }

  // ===== ввод: перестановка по второму клику =====
  private enableClickSwap(): void {
    const zone = this.scene.add.zone(0, 0, this.scene.scale.width, this.scene.scale.height)
      .setOrigin(0)
      .setInteractive();

    zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const cell = this.worldToCell(p.worldX, p.worldY);
      if (!cell) return;
      const gem = this.grid[cell.r][cell.c];

      if (!this.selected) {
        // первый клик — выделяем
        this.selected = gem;
        this.highlightOn(gem.sprite);
        return;
      }

      // если повторный клик по той же — снять выделение
      if (this.selected === gem) {
        this.highlightOff(gem.sprite);
        this.selected = undefined;
        return;
      }

      // второй клик — только если сосед
      const isNeighbor = (Math.abs(this.selected.row - gem.row) + Math.abs(this.selected.col - gem.col)) === 1;
      if (isNeighbor) {
        const a = this.selected;
        const b = gem;
        this.swapCells(a, b, true);
        this.highlightOff(a.sprite);
        this.highlightOff(b.sprite);
        this.selected = undefined;
      } else {
        // если не сосед — пере­выделяем: снять со старого, выделить новый
        this.highlightOff(this.selected.sprite);
        this.selected = gem;
        this.highlightOn(gem.sprite);
      }
    });
  }

  private swapCells(a: GemCell, b: GemCell, animate: boolean) {
    if (a === b) return;

    const aPos = this.cellCenter(a.row, a.col);
    const bPos = this.cellCenter(b.row, b.col);

    // поменять в логике
    const ar = a.row, ac = a.col;
    const br = b.row, bc = b.col;
    this.grid[ar][ac] = b; b.row = ar; b.col = ac;
    this.grid[br][bc] = a; a.row = br; a.col = bc;

    if (animate) {
      this.scene.tweens.add({ targets: a.sprite, x: bPos.x, y: bPos.y, duration: SWAP_DURATION, ease: SWAP_EASE });
      this.scene.tweens.add({ targets: b.sprite, x: aPos.x, y: aPos.y, duration: SWAP_DURATION, ease: SWAP_EASE });
    } else {
      a.sprite.setPosition(bPos.x, bPos.y);
      b.sprite.setPosition(aPos.x, aPos.y);
    }
  }
}
