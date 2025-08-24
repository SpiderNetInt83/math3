import Phaser from 'phaser'

// ====== Локальные константы проекта (без внешних зависимостей) ======
// Цвета нужны только для частиц/эффектов
const COLORS: number[] = [0xff3b30, 0x34c759, 0x007aff, 0xffcc00]; // red, green, blue, yellow
const TWEEN_DUR = {
  swap: 150,
  drop: 160,
  clear: 220
} as const

// дефолтные ключи текстур фишек (можно переопределить через конфиг)
const DEFAULT_GEM_KEYS = ['red', 'green', 'blue', 'yellow'] as const

type GemType = number // индекс в массиве gemKeys
type GemKind = 'normal' | 'stripeH' | 'stripeV' | 'bomb' | 'color'
type Orientation = 'row' | 'col'

interface Gem {
  row: number
  col: number
  type: GemType
  kind: GemKind
  sprite: Phaser.GameObjects.Image
  mark?: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]
}

interface MatchGroup {
  gems: Gem[]
  orientation: Orientation
}

// Настройки доски, которые можно передать в конструктор
export interface BoardConfig {
  rows?: number // по умолчанию 8
  cols?: number // по умолчанию 8
  colors?: number | string[] // количество цветов или конкретные ключи текстур
  marginX?: number // отступы слева/справа (px), по умолчанию 24
  offsetYRatio?: number // вертикальное смещение относительно высоты экрана (0..1), по умолчанию 0.22
}

export default class Board {
  private scene: Phaser.Scene
  private rows: number
  private cols: number
  private cellSize: number
  private offsetX: number
  private offsetY: number
  private radius: number

  private readonly colors: number[] = COLORS

  private grid: (Gem | null)[][] = []
  private selected: Gem | null = null
  private isBusy = false
  private isLocked = false

  private cascadeDepth = 0
  private hintPair: [Gem, Gem] | null = null
  private lastSwapA: Gem | null = null
  private lastSwapB: Gem | null = null

  // динамический список ключей спрайтов фишек
  private gemKeys: string[]

  constructor(scene: Phaser.Scene, cfg: BoardConfig = {}) {
    this.scene = scene

    // применяем конфиг
    this.rows = Math.max(3, Math.floor(cfg.rows ?? 8))
    this.cols = Math.max(3, Math.floor(cfg.cols ?? 8))

    // ключи спрайтов фишек: количество (берём первые N) или массив строк
    if (Array.isArray(cfg.colors)) {
      this.gemKeys = cfg.colors
    } else {
      const count = Math.max(3, Math.min((cfg.colors ?? DEFAULT_GEM_KEYS.length) as number, DEFAULT_GEM_KEYS.length))
      this.gemKeys = DEFAULT_GEM_KEYS.slice(0, count) as unknown as string[]
    }

    // Расчёт размеров под экран и отступы по умолчанию
    const width = this.scene.scale.width
    const height = this.scene.scale.height
    const marginX = cfg.marginX ?? 24
    const availableWidth = width - marginX * 2
    const availableHeight = height * 0.6 // оставим место сверху/снизу
    this.cellSize = Math.floor(Math.min(availableWidth / this.cols, availableHeight / this.rows))

    this.offsetX = (width - this.cellSize * this.cols) / 2
    const offsetYRatio = cfg.offsetYRatio ?? 0.22
    this.offsetY = Math.floor(height * offsetYRatio)

    this.radius = this.cellSize * 0.45
  }

  public lock() { this.isLocked = true }

  create() {
    // фон клеток (по желанию)
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const { x, y } = this.rcToXY(r, c)
        this.scene.add.rectangle(x, y, this.cellSize - 4, this.cellSize - 4, 0x000000, 0.12)
          .setStrokeStyle(1, 0xffffff, 0.08).setDepth(0)
      }
    }

    const types = this.generateStartTypes()

    for (let r = 0; r < this.rows; r++) {
      this.grid[r] = []
      for (let c = 0; c < this.cols; c++) {
        this.grid[r][c] = this.spawnGem(r, c, types[r][c])
      }
    }
  }

  // ---------- генерация стартовой матрицы ----------
  private generateStartTypes(): GemType[][] {
    const maxAttempts = 50
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const types: GemType[][] = Array.from({ length: this.rows }, () => Array(this.cols).fill(0) as GemType[])
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          let t: GemType, tries = 0
          do {
            t = this.randType(); tries++
            if (tries > 100) break
          } while (this.causesImmediateMatch(types, r, c, t))
          types[r][c] = t
        }
      }
      if (this.hasAnyPossibleMove(types)) return types
    }
    // fallback
    const types: GemType[][] = Array.from({ length: this.rows }, () => Array(this.cols).fill(0) as GemType[])
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        let t: GemType, tries = 0
        do {
          t = this.randType(); tries++
          if (tries > 100) break
        } while (this.causesImmediateMatch(types, r, c, t))
        types[r][c] = t
      }
    }
    return types
  }

  private causesImmediateMatch(types: GemType[][], r: number, c: number, t: GemType): boolean {
    if (c >= 2 && types[r][c - 1] === t && types[r][c - 2] === t) return true
    if (r >= 2 && types[r - 1][c] === t && types[r - 2][c] === t) return true
    return false
  }

  private hasAnyPossibleMove(types: GemType[][]): boolean {
    const dirs = [[0,1],[1,0]]
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      for (const [dr, dc] of dirs) {
        const r2 = r + dr, c2 = c + dc
        if (r2 >= this.rows || c2 >= this.cols) continue
        if (types[r][c] === types[r2][c2]) continue
        if (this.wouldSwapCreateMatch(types, r, c, r2, c2)) return true
      }
    }
    return false
  }

  private wouldSwapCreateMatch(types: GemType[][], r1: number, c1: number, r2: number, c2: number): boolean {
    const t1 = types[r1][c1], t2 = types[r2][c2]
    types[r1][c1] = t2; types[r2][c2] = t1
    const ok = this.hasMatchAt(types, r1, c1) || this.hasMatchAt(types, r2, c2)
    types[r1][c1] = t1; types[r2][c2] = t2
    return ok
  }

  private hasMatchAt(types: GemType[][], r: number, c: number): boolean {
    const t = types[r][c]
    let count = 1
    for (let cc = c - 1; cc >= 0 && types[r][cc] === t; cc--) count++
    for (let cc = c + 1; cc < this.cols && types[r][cc] === t; cc++) count++
    if (count >= 3) return true
    count = 1
    for (let rr = r - 1; rr >= 0 && types[rr][c] === t; rr--) count++
    for (let rr = r + 1; rr < this.rows && types[rr][c] === t; rr++) count++
    return count >= 3
  }

  // ---------- ввод: выбор вторым кликом ----------
  private onGemPointerDown = (sprite: Phaser.GameObjects.Image) => {
    if (this.isBusy || this.isLocked) return
    const row = sprite.getData('row') as number
    const col = sprite.getData('col') as number
    const gem = this.getGem(row, col)
    if (!gem) return

    this.clearHint()

    if (this.selected && this.selected === gem) { this.unhighlight(this.selected); this.selected = null; return }
    if (!this.selected) { this.selected = gem; this.highlight(gem); this.playSfx('click', { volume: 0.3 }); return }
    if (this.areNeighbors(this.selected, gem)) {
      const a = this.selected, b = gem
      this.unhighlight(a); this.selected = null
      this.swapGems(a, b); return
    }
    this.unhighlight(this.selected); this.selected = gem; this.highlight(gem); this.playSfx('click', { volume: 0.3 })
  }

  private highlight(g: Gem) {
    this.tweenScaleToSize(g, 1.06, 90)
    this.setDepthFor(g, 2)
  }

  private unhighlight(g: Gem) {
    this.tweenScaleToSize(g, 1.0, 90)
    this.setDepthFor(g, 1)
  }

  // ---------- своп / откат / каскад ----------
  private areNeighbors(a: Gem, b: Gem) { return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1 }

  private swapGems(a: Gem, b: Gem) {
    this.isBusy = true
    this.clearHint()
    this.lastSwapA = a; this.lastSwapB = b
    this.playSfx('swap', { volume: 0.4 })

    const ar = a.row, ac = a.col
    const br = b.row, bc = b.col
    const Ato = this.rcToXY(br, bc), Bto = this.rcToXY(ar, ac)

    let done = 0
    const onDone = () => {
      if (++done < 2) return
      a.row = br; a.col = bc; b.row = ar; b.col = ac
      a.sprite.setData('row', br).setData('col', bc)
      b.sprite.setData('row', ar).setData('col', ac)
      this.grid[br][bc] = a; this.grid[ar][ac] = b

      const aIsColor = a.kind === 'color'
      const bIsColor = b.kind === 'color'

      if (aIsColor || bIsColor) {
        this.scene.events.emit('valid-move')
        this.cascadeDepth = 0

        const targetType: GemType | null =
          aIsColor && !bIsColor ? b.type :
          bIsColor && !aIsColor ? a.type :
          null

        const toClear = new Set<Gem>()
        if (targetType !== null) {
          for (let r = 0; r < this.rows; r++)
            for (let c = 0; c < this.cols; c++) { const g = this.grid[r][c]; if (g && g.type === targetType) toClear.add(g) }
        } else {
          for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) { const g = this.grid[r][c]; if (g) toClear.add(g) }
        }
        toClear.add(a); toClear.add(b)

        this.clearBySet(toClear, () => {
          const next = this.findMatches()
          this.processCascade(next)
        })
        return
      }

      const matches = this.findMatches()
      if (matches.length > 0) {
        this.scene.events.emit('valid-move')
        this.cascadeDepth = 0
        this.playSfx('match', { volume: 0.5 })
        this.processCascade(matches)
      } else {
        this.revertSwap(a, b, ar, ac, br, bc)
      }
    }

    this.moveGemTo(a, Ato.x, Ato.y, 120, 'Quad.InOut', onDone)
    this.moveGemTo(b, Bto.x, Bto.y, 120, 'Quad.InOut', onDone)
  }

  private revertSwap(a: Gem, b: Gem, ar: number, ac: number, br: number, bc: number) {
    const Aback = this.rcToXY(ar, ac), Bback = this.rcToXY(br, bc)
    let done = 0
    const onDone = () => {
      if (++done < 2) return
      a.row = ar; a.col = ac; b.row = br; b.col = bc
      a.sprite.setData('row', ar).setData('col', ac)
      b.sprite.setData('row', br).setData('col', bc)
      this.grid[ar][ac] = a; this.grid[br][bc] = b
      this.isBusy = false
    }
    this.moveGemTo(a, Aback.x, Aback.y, 120, 'Quad.InOut', onDone)
    this.moveGemTo(b, Bback.x, Bback.y, 120, 'Quad.InOut', onDone)
  }

  private processCascade(initialGroups: MatchGroup[]) {
    this.clearHint()
    const step = (groups: MatchGroup[]) => {
      if (groups.length === 0) {
        const typesNow = this.snapshotTypes()
        const finish = () => { this.isBusy = false; this.scene.events.emit('cascade-complete') }
        if (!this.hasAnyPossibleMove(typesNow)) this.reshuffleToPlayable(typesNow, finish)
        else finish()
        return
      }
      this.cascadeDepth += 1
      this.clearAndDrop(groups, () => {
        const next = this.findMatches()
        step(next)
      })
    }
    step(initialGroups)
  }

  // ---------- поиск матчей ----------
  private findMatches(): MatchGroup[] {
    const groups: MatchGroup[] = []

    // строки
    for (let r = 0; r < this.rows; r++) {
      let run: Gem[] = []
      let prev: GemType | null = null
      for (let c = 0; c < this.cols; c++) {
        const g = this.grid[r][c]; const t = g?.type
        if (g && t === prev) run.push(g)
        else {
          if (run.length >= 3) groups.push({ gems: [...run], orientation: 'row' })
          run = g ? [g] : []; prev = g ? g.type : null
        }
      }
      if (run.length >= 3) groups.push({ gems: [...run], orientation: 'row' })
    }

    // столбцы
    for (let c = 0; c < this.cols; c++) {
      let run: Gem[] = []
      let prev: GemType | null = null
      for (let r = 0; r < this.rows; r++) {
        const g = this.grid[r][c]; const t = g?.type
        if (g && t === prev) run.push(g)
        else {
          if (run.length >= 3) groups.push({ gems: [...run], orientation: 'col' })
          run = g ? [g] : []; prev = g ? g.type : null
        }
      }
      if (run.length >= 3) groups.push({ gems: [...run], orientation: 'col' })
    }

    return groups
  }

  // ---------- детекторы 5 ----------
  private detectCornerFive(groups: MatchGroup[]) {
    const rows = groups.filter(g => g.orientation === 'row' && g.gems.length === 3)
    const cols = groups.filter(g => g.orientation === 'col' && g.gems.length === 3)
    const out: { union: Set<Gem>, corner: Gem }[] = []
    const seen = new Set<string>()

    for (const rg of rows) {
      const type = rg.gems[0].type
      const rSorted = [...rg.gems].sort((a, b) => a.col - b.col)
      for (const cg of cols) {
        if (cg.gems[0].type !== type) continue
        const cSorted = [...cg.gems].sort((a, b) => a.row - b.row)
        const inter = rSorted.find(g => cg.gems.includes(g))
        if (!inter) continue

        const isRowEndpoint = inter === rSorted[0] || inter === rSorted[rSorted.length - 1]
        const isColEndpoint = inter === cSorted[0] || inter === cSorted[cSorted.length - 1]
        if (!isRowEndpoint || !isColEndpoint) continue

        const union = new Set<Gem>([...rg.gems, ...cg.gems])
        if (union.size === 5) {
          const key = `${inter.row},${inter.col},${type}`
          if (!seen.has(key)) { seen.add(key); out.push({ union, corner: inter }) }
        }
      }
    }
    return out
  }

  private detectTShapeFive(groups: MatchGroup[]) {
    const rows = groups.filter(g => g.orientation === 'row' && g.gems.length === 3)
    const cols = groups.filter(g => g.orientation === 'col' && g.gems.length === 3)
    const out: { union: Set<Gem>, center: Gem }[] = []
    const seen = new Set<string>()

    for (const rg of rows) {
      const type = rg.gems[0].type
      const rSorted = [...rg.gems].sort((a, b) => a.col - b.col)
      for (const cg of cols) {
        if (cg.gems[0].type !== type) continue
        const cSorted = [...cg.gems].sort((a, b) => a.row - b.row)
        const inter = rSorted.find(g => cg.gems.includes(g))
        if (!inter) continue

        const isRowMiddle = inter === rSorted[1]
        const isColMiddle = inter === cSorted[1]
        if (!isRowMiddle && !isColMiddle) continue

        const union = new Set<Gem>([...rg.gems, ...cg.gems])
        if (union.size === 5) {
          const key = `${inter.row},${inter.col},${type}`
          if (!seen.has(key)) { seen.add(key); out.push({ union, center: inter }) }
        }
      }
    }
    return out
  }

  private detectLineFive(groups: MatchGroup[]) {
    const out: { union: Set<Gem>, center: Gem }[] = []
    for (const g of groups) {
      if (g.gems.length === 5) {
        const center = g.gems[2]
        out.push({ union: new Set(g.gems), center })
      }
    }
    return out
  }

  // ---------- удаление + спец-фишки + падение + дозаполнение ----------
  private clearAndDrop(groups: MatchGroup[], onFinished: () => void) {
    const toClear = new Set<Gem>()
    for (const g of groups.flatMap(gr => gr.gems)) toClear.add(g)

    // звук
    this.playSfx(toClear.size >= 4 ? 'special' : 'match', { volume: 0.5 })

    // эффекты
    for (const g of toClear) this.createParticles(g.sprite.x, g.sprite.y, this.colors[g.type])

    // 1) полосатые из длинных линий (>=4)
    const preserve = new Set<Gem>()
    for (const grp of groups) {
      if (grp.gems.length >= 4) {
        const carrier = this.pickSpecialCarrier(grp.gems)
        const kind: GemKind = grp.orientation === 'row' ? 'stripeH' : 'stripeV'
        this.setKind(carrier, kind)
        preserve.add(carrier)
      }
    }

    // 2) L- и T-пятёрки
    for (const item of this.detectCornerFive(groups)) { const carrier = this.pickSpecialCarrier([...item.union]); this.setKind(carrier, 'bomb'); preserve.add(carrier) }
    for (const item of this.detectTShapeFive(groups)) { const carrier = this.pickSpecialCarrier([...item.union]); this.setKind(carrier, 'bomb'); preserve.add(carrier) }

    // 3) 5 в линию — цветная бомба
    for (const item of this.detectLineFive(groups)) { const carrier = this.pickSpecialCarrier([...item.union]); this.setKind(carrier, 'color'); preserve.add(carrier) }

    for (const g of preserve) toClear.delete(g)

    this.expandSpecialClears(toClear)

    this.scene.events.emit('gems-cleared', { count: toClear.size, depth: this.cascadeDepth })

    let pending = 0
    const afterClear = () => {
      if (--pending === 0) {
        for (const g of toClear) {
          this.grid[g.row][g.col] = null
          if (g.mark) { if (Array.isArray(g.mark)) g.mark.forEach(m => m.destroy()); else g.mark.destroy(); g.mark = undefined }
          g.sprite.destroy()
        }
        this.dropAndRefill(onFinished)
      }
    }

    for (const g of toClear) {
      pending++
      this.scene.tweens.add({ targets: this.targetsFor(g), scale: 0.4, alpha: 0.0, duration: TWEEN_DUR.swap, ease: 'Quad.In', onComplete: afterClear })
    }
    if (pending === 0) this.dropAndRefill(onFinished)
  }

  private pickSpecialCarrier(gems: Gem[]): Gem {
    const prefer = (g: Gem | null) => (g && gems.includes(g)) ? g : null
    return prefer(this.lastSwapA) || prefer(this.lastSwapB) || gems[Math.floor(gems.length / 2)]
  }

  private expandSpecialClears(toClear: Set<Gem>) {
    const queue: Gem[] = [...toClear]
    const seen = new Set<Gem>(queue)

    while (queue.length) {
      const g = queue.shift()!
      if (g.kind === 'stripeH') {
        for (let c = 0; c < this.cols; c++) { const t = this.grid[g.row][c]; if (t && !seen.has(t)) { toClear.add(t); queue.push(t); seen.add(t) } }
      } else if (g.kind === 'stripeV') {
        for (let r = 0; r < this.rows; r++) { const t = this.grid[r][g.col]; if (t && !seen.has(t)) { toClear.add(t); queue.push(t); seen.add(t) } }
      } else if (g.kind === 'bomb') {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = g.row + dr, cc = g.col + dc
          if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) continue
          const t = this.grid[rr][cc]
          if (t && !seen.has(t)) { toClear.add(t); queue.push(t); seen.add(t) }
        }
      }
    }
  }

  private clearBySet(toClear: Set<Gem>, onDone: () => void) {
    this.expandSpecialClears(toClear)
    this.scene.events.emit('gems-cleared', { count: toClear.size, depth: this.cascadeDepth })

    let pending = 0
    const afterClear = () => {
      if (--pending === 0) {
        for (const g of toClear) {
          this.grid[g.row][g.col] = null
          if (g.mark) { if (Array.isArray(g.mark)) g.mark.forEach(m => m.destroy()); else g.mark.destroy(); g.mark = undefined }
          g.sprite.destroy()
        }
        this.dropAndRefill(onDone)
      }
    }

    for (const g of toClear) {
      pending++
      this.scene.tweens.add({ targets: this.targetsFor(g), scale: 0.1, duration: TWEEN_DUR.clear, ease: 'Back.In', onComplete: afterClear })
    }
  }

  private dropAndRefill(onFinished: () => void) {
    let pending = 0
    const done = () => { if (--pending === 0) onFinished() }

    for (let c = 0; c < this.cols; c++) {
      let writeRow = this.rows - 1
      for (let r = this.rows - 1; r >= 0; r--) {
        const g = this.grid[r][c]
        if (g) {
          if (r !== writeRow) {
            const to = this.rcToXY(writeRow, c)
            pending++
            this.moveGemTo(g, to.x, to.y, 140, 'Quad.In', done)
            this.grid[writeRow][c] = g
            this.grid[r][c] = null
            g.row = writeRow; g.col = c
            g.sprite.setData('row', writeRow).setData('col', c)
          }
          writeRow--
        }
      }

      for (let r = writeRow; r >= 0; r--) {
        const type = this.randType()
        const { x: targetX, y: targetY } = this.rcToXY(r, c)
        const spawnY = this.offsetY - this.cellSize * (writeRow - r + 1)

        const textureKey = this.gemKeys[type]
        const sprite = this.scene.add.image(targetX, spawnY, textureKey)
          .setDisplaySize(this.cellSize * 0.9, this.cellSize * 0.9)
          .setDepth(1)
          .setInteractive({ useHandCursor: true })

        sprite.setData('row', r).setData('col', c).setData('type', type)
        sprite.on('pointerdown', () => this.onGemPointerDown(sprite))

        const gem: Gem = { row: r, col: c, type: type as GemType, kind: 'normal', sprite }
        this.grid[r][c] = gem

        pending++
        this.scene.tweens.add({ targets: gem.sprite, y: targetY, duration: TWEEN_DUR.drop, ease: 'Quad.In', onComplete: done })
      }
    }

    if (pending === 0) onFinished()
  }

  // ---------- reshuffle ----------
  private snapshotTypes(): GemType[][] {
    const types: GemType[][] = Array.from({ length: this.rows }, () => Array(this.cols).fill(0) as GemType[])
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) types[r][c] = this.grid[r][c]!.type
    return types
  }

  private reshuffleToPlayable(current: GemType[][], onDone: () => void) {
    this.isBusy = true

    const pool: GemType[] = []
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) pool.push(current[r][c])

    const attemptLimit = 80
    let picked: GemType[][] | null = null

    for (let attempt = 0; attempt < attemptLimit; attempt++) {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp
      }
      const t: GemType[][] = Array.from({ length: this.rows }, () => Array(this.cols).fill(0) as GemType[])
      let k = 0
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) t[r][c] = pool[k++]!

      if (!this.hasAnyMatchesInTypes(t) && this.hasAnyPossibleMove(t)) { picked = t; break }
    }

    if (!picked) picked = this.generateStartTypes()

    let pending = 0
    const done = () => { if (--pending === 0) onDone() }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const g = this.grid[r][c]!
        const newType = picked[r][c]
        pending++
        this.scene.tweens.add({
          targets: this.targetsFor(g),
          scale: 0.85,
          duration: 80,
          ease: 'Quad.In',
          yoyo: true,
          onYoyo: () => {
            g.type = newType
            g.sprite.setData('type', newType)
            g.sprite.setTexture(this.gemKeys[newType])
          },
          onComplete: done
        })
      }
    }
  }

  private hasAnyMatchesInTypes(types: GemType[][]): boolean {
    for (let r = 0; r < this.rows; r++) {
      let run = 1
      for (let c = 1; c < this.cols; c++) {
        if (types[r][c] === types[r][c - 1]) run++
        else { if (run >= 3) return true; run = 1 }
      }
      if (run >= 3) return true
    }
    for (let c = 0; c < this.cols; c++) {
      let run = 1
      for (let r = 1; r < this.rows; r++) {
        if (types[r][c] === types[r - 1][c]) run++
        else { if (run >= 3) return true; run = 1 }
      }
      if (run >= 3) return true
    }
    return false
  }

  // ---------- подсказка ----------
  public findHintPair(): [Gem, Gem] | null {
    const types = this.snapshotTypes()
    const dirs = [[0,1],[1,0]]
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      for (const [dr, dc] of dirs) {
        const r2 = r + dr, c2 = c + dc
        if (r2 >= this.rows || c2 >= this.cols) continue
        if (types[r][c] === types[r2][c2]) continue
        if (this.wouldSwapCreateMatch(types, r, c, r2, c2)) {
          return [this.grid[r][c]!, this.grid[r2][c2]!]
        }
      }
    }
    return null
  }

  public showHint(): boolean {
    if (this.isBusy || this.isLocked) return false
    if (this.hintPair) return true
    const pair = this.findHintPair()
    if (!pair) return false
    this.hintPair = pair
    for (const g of pair) {
      this.scene.tweens.killTweensOf(this.targetsFor(g))
      this.setDepthFor(g, 3)
      this.scene.tweens.add({ targets: this.targetsFor(g), scale: 1.12, duration: 280, ease: 'Sine.InOut', yoyo: true, repeat: -1 })
    }
    return true
  }

  public clearHint() {
    if (!this.hintPair) return
    for (const g of this.hintPair) {
      this.scene.tweens.killTweensOf(this.targetsFor(g))
      this.tweenScaleToSize(g, 1, 80)
      this.setDepthFor(g, 1)
    }
    this.hintPair = null
  }

  // ---------- утилиты ----------
  private rcToXY(row: number, col: number) { return { x: this.offsetX + (col + 0.5) * this.cellSize, y: this.offsetY + (row + 0.5) * this.cellSize } }
  private randType(): GemType { return Math.floor(Math.random() * this.gemKeys.length) }

  private spawnGem(row: number, col: number, type: GemType): Gem {
    const { x, y } = this.rcToXY(row, col)

    const textureKey = this.gemKeys[type]
    const sprite = this.scene.add.image(x, y, textureKey)
      .setDisplaySize(this.cellSize * 0.9, this.cellSize * 0.9)
      .setDepth(1)
      .setInteractive({ useHandCursor: true })

    sprite.setData('row', row).setData('col', col).setData('type', type)
    sprite.on('pointerdown', () => this.onGemPointerDown(sprite))

    // анимация появления
    sprite.setAlpha(0)
    this.scene.tweens.add({ targets: sprite, alpha: 1, duration: 150, ease: 'Sine.Out' })

    return { row, col, type, kind: 'normal', sprite }
  }

  private getGem(row: number, col: number): Gem | undefined {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return undefined
    return this.grid[row][col] ?? undefined
  }

  private setKind(g: Gem, kind: GemKind) {
    if (g.mark) { if (Array.isArray(g.mark)) g.mark.forEach(m => m.destroy()); else g.mark.destroy(); g.mark = undefined }
    g.kind = kind
    if (kind === 'normal') return

    // Простые маркеры booster'ов примитивами (без внешних текстур)
    const { x, y } = g.sprite
    const w = (g.sprite as Phaser.GameObjects.Image).displayWidth
    const h = (g.sprite as Phaser.GameObjects.Image).displayHeight

    if (kind === 'stripeH') {
      const mark = this.scene.add.rectangle(x, y, w * 0.9, h * 0.2, 0xffffff, 0.6).setDepth(2)
      g.mark = mark
    } else if (kind === 'stripeV') {
      const mark = this.scene.add.rectangle(x, y, w * 0.2, h * 0.9, 0xffffff, 0.6).setDepth(2)
      g.mark = mark
    } else if (kind === 'bomb') {
      const mark = this.scene.add.circle(x, y, Math.max(w, h) * 0.4, 0xffffff, 0.6).setDepth(2)
      g.mark = mark
    } else if (kind === 'color') {
      const ring = this.scene.add.circle(x, y, Math.max(w, h) * 0.48, 0xffffff, 0).setStrokeStyle(3, 0xffffff, 0.9).setDepth(2)
      g.mark = ring
    }

    // вспышка
    const flash = this.scene.add.circle(x, y, Math.max(w, h) * 0.5, 0xffffff, 0.85)
    this.scene.tweens.add({ targets: flash, scale: 2.0, alpha: 0, duration: 360, ease: 'Cubic.Out', onComplete: () => flash.destroy() })
  }

  private moveGemTo(g: Gem, x: number, y: number, duration: number, ease: string, onComplete?: () => void) {
    this.scene.tweens.add({ targets: this.targetsFor(g), x, y, duration, ease, onComplete })
  }

  private tweenScaleToSize(g: Gem, factor: number, duration: number) {
    const targets = this.targetsFor(g)
    for (const t of targets) {
      const img = t as Phaser.GameObjects.Image
      const baseW = this.cellSize * 0.9
      const baseH = this.cellSize * 0.9
      this.scene.tweens.add({ targets: img, displayWidth: baseW * factor, displayHeight: baseH * factor, duration, ease: 'Quad.Out' })
    }
  }

  private setDepthFor(g: Gem, depth: number) {
    g.sprite.setDepth(depth)
    if (g.mark) { if (Array.isArray(g.mark)) g.mark.forEach(m => (m as any).setDepth?.(depth)); else (g.mark as any).setDepth?.(depth) }
  }

  private targetsFor(g: Gem): Phaser.GameObjects.GameObject[] {
    const arr: Phaser.GameObjects.GameObject[] = [g.sprite]
    if (g.mark) { if (Array.isArray(g.mark)) arr.push(...g.mark); else arr.push(g.mark) }
    return arr
  }

  // безопасное воспроизведение SFX (если ключ не загружен — просто игнорируем)
  private playSfx(key: string, config?: any) {
    const snd: any = (this.scene as any).sound;
    if (!snd) return;
    try { snd.play(key, config); } catch (e) { /* ключ не загружен — пропускаем */ }
  }

  // --- эффекты ---
  private createParticles(x: number, y: number, color: number) {
    const particleCount = 14
    const particleSize = this.radius * 0.28

    const flash = this.scene.add.circle(x, y, this.radius, color, 0.7)
    this.scene.tweens.add({ targets: flash, scale: 2.0, alpha: 0, duration: TWEEN_DUR.clear, onComplete: () => flash.destroy() })

    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2
      const distance = this.radius * 1.5
      const px = x + Math.cos(angle) * distance
      const py = y + Math.sin(angle) * distance
      const p = this.scene.add.circle(x, y, particleSize, color, 0.85)
      this.scene.tweens.add({ targets: p, x: px, y: py, alpha: 0, scale: { from: 1.2, to: 0.2 }, duration: TWEEN_DUR.clear * 1.6, ease: 'Cubic.Out', onComplete: () => p.destroy() })
    }

    const ring = this.scene.add.circle(x, y, this.radius * 0.5, color, 0).setStrokeStyle(3, color, 0.9)
    this.scene.tweens.add({ targets: ring, scale: 3.0, alpha: 0, duration: TWEEN_DUR.clear * 1.8, ease: 'Quad.Out', onComplete: () => ring.destroy() })

    const inner = this.scene.add.circle(x, y, this.radius * 0.7, color, 0.5)
    this.scene.tweens.add({ targets: inner, scale: 0.1, alpha: 0, duration: TWEEN_DUR.clear * 1.1, ease: 'Sine.In', onComplete: () => inner.destroy() })
  }
}
