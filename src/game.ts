import { CONFIG } from './config';
import { createQuestion, Operation, Question } from './question';
import { Shape, spawnShapes } from './shape';
import { Renderer } from './renderer';
import { InputHandler } from './input';
import { AudioManager } from './audio';
import { ScoreManager } from './score';
import { UserStore, UserProfile } from './user';

type GameState =
  | 'user-select'
  | 'name-entry'
  | 'confirm-delete'
  | 'confirm-delete-final'
  | 'op-picker'
  | 'level-picker'
  | 'start'
  | 'countdown'
  | 'playing'
  | 'new-question'
  | 'celebration'
  | 'game-over';

export class Game {
  private renderer: Renderer;
  private input: InputHandler;
  private audio = new AudioManager();
  private userStore = new UserStore();
  private scoreManager!: ScoreManager;
  private currentUser: UserProfile | null = null;

  private state: GameState = 'user-select';
  private paused = false;
  private question: Question | null = null;
  private shapes: Shape[] = [];

  private countdownValue = CONFIG.COUNTDOWN_SECONDS;
  private countdownTimer = 0;
  private newQuestionTimer = 0;

  // User input state
  private nameInput = '';
  private deleteMode = false;
  private deleteTarget: UserProfile | null = null;

  // Operation / level select state
  private selectedOp: Operation = '+';
  private selectedLevel = 1;

  // Celebration state
  private celebrationMessage = '';
  private celebrationTimer = 0;

  // Wrong answer tracking per question (#7)
  private wrongCount = 0;

  private lastTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new InputHandler(canvas);
    this.input.onTap((x, y) => this.handleTap(x, y));
  }

  start(): void {
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  private loop(time: number): void {
    const dt = Math.min((time - this.lastTime) / 1000, 0.1); // cap at 100ms
    this.lastTime = time;

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.loop(t));
  }

  private update(dt: number): void {
    if (this.paused) return;

    switch (this.state) {
      case 'countdown':
        this.countdownTimer -= dt;
        if (this.countdownTimer <= 0) {
          this.countdownValue--;
          this.countdownTimer = 1;
          if (this.countdownValue <= 0) {
            this.state = 'playing';
            this.nextQuestion();
          }
        }
        break;

      case 'playing':
        this.updatePlaying(dt);
        break;

      case 'new-question':
        this.newQuestionTimer -= dt;
        if (this.newQuestionTimer <= 0) {
          this.nextQuestion();
          this.state = 'playing';
        }
        break;

      case 'celebration':
        this.celebrationTimer -= dt;
        if (this.celebrationTimer <= 0) {
          this.state = 'playing';
          this.nextQuestion();
        }
        break;
    }

    this.renderer.updateParticles(dt);
    this.renderer.updateBgSymbols(dt);
  }

  private updatePlaying(dt: number): void {
    for (const shape of this.shapes) {
      shape.update(dt);
    }

    // Check if correct answer fell off screen
    const h = this.renderer.getHeight();
    const correctShape = this.shapes.find(
      (s) => s.alive && s.answer === this.question?.answer
    );
    if (correctShape && correctShape.y > h + correctShape.radius) {
      // Missed the correct answer — game over
      this.endGame();
      return;
    }

    // Remove shapes that fell off (wrong answers)
    this.shapes = this.shapes.filter(
      (s) => s.y < h + s.radius + 50 || s.answer === this.question?.answer
    );
  }

  private isAllComplete(): boolean {
    if (!this.currentUser) return false;
    return CONFIG.OP_ORDER.every(
      (op) => this.currentUser!.progress[op as Operation].unlockedLevel >= CONFIG.LEVELS_PER_OP,
    );
  }

  private render(): void {
    switch (this.state) {
      case 'user-select':
        this.renderer.drawUserSelect(this.userStore.list(), this.deleteMode);
        break;

      case 'name-entry':
        this.renderer.drawNameEntry(this.nameInput);
        break;

      case 'confirm-delete':
        this.renderer.drawDeleteConfirm(this.deleteTarget?.name ?? '', false);
        break;

      case 'confirm-delete-final':
        this.renderer.drawDeleteConfirm(this.deleteTarget?.name ?? '', true);
        break;

      case 'op-picker':
        this.renderer.drawOpPicker(
          this.currentUser?.progress ?? {
            '+': { unlockedLevel: 1, levelBestScores: [] },
            '−': { unlockedLevel: 0, levelBestScores: [] },
            '×': { unlockedLevel: 0, levelBestScores: [] },
            '÷': { unlockedLevel: 0, levelBestScores: [] },
          },
        );
        break;

      case 'level-picker':
        this.renderer.drawLevelPicker(
          this.selectedOp,
          this.currentUser?.progress[this.selectedOp] ?? { unlockedLevel: 1, levelBestScores: [] },
        );
        break;

      case 'start':
        this.renderer.drawStartScreen();
        break;

      case 'countdown':
        this.renderer.drawCountdown(this.countdownValue);
        break;

      case 'playing':
      case 'new-question':
      case 'celebration':
        if (this.paused && this.state !== 'celebration') {
          this.renderer.drawPauseScreen();
        } else {
          this.renderer.clear();
          this.renderer.drawShapes(this.shapes);
          this.renderer.drawParticles();
          if (this.question) {
            this.renderer.drawQuestion(this.question.text);
          }
          this.renderer.drawHUD(
            this.scoreManager.score,
            this.scoreManager.highScore,
            this.scoreManager.level,
          );
          if (this.state === 'celebration' && this.celebrationMessage) {
            const duration = CONFIG.CELEBRATION_DURATION_MS / 1000;
            const progress = 1 - this.celebrationTimer / duration;
            this.renderer.drawCelebration(this.celebrationMessage, progress);
          }
        }
        break;

      case 'game-over':
        this.renderer.clear();
        this.renderer.drawShapes(this.shapes);
        this.renderer.drawParticles();
        if (this.question) {
          this.renderer.drawQuestion(this.question.text);
        }
        this.renderer.drawHUD(
          this.scoreManager.score,
          this.scoreManager.highScore,
          this.scoreManager.level,
        );
        this.renderer.drawGameOver(
          this.scoreManager.score,
          this.scoreManager.highScore,
          this.scoreManager.score >= this.scoreManager.highScore && this.scoreManager.score > 0,
        );
        break;
    }
  }

  private handleTap(x: number, y: number): void {
    switch (this.state) {
      case 'user-select':
        this.handleUserSelectTap(x, y);
        break;

      case 'name-entry':
        if (this.hitTest(x, y, this.renderer.getBackButtonRect())) {
          this.state = 'user-select';
        } else {
          this.handleNameEntryTap(x, y);
        }
        break;

      case 'confirm-delete':
      case 'confirm-delete-final':
        this.handleDeleteConfirmTap(x, y);
        break;

      case 'op-picker':
        if (this.hitTest(x, y, this.renderer.getBackButtonRect())) {
          this.state = 'user-select';
        } else {
          this.handleOpPickerTap(x, y);
        }
        break;

      case 'level-picker':
        if (this.hitTest(x, y, this.renderer.getBackButtonRect())) {
          this.state = 'op-picker';
        } else {
          this.handleLevelPickerTap(x, y);
        }
        break;

      case 'start':
        if (this.hitTest(x, y, this.renderer.getBackButtonRect())) {
          this.state = 'level-picker';
        } else {
          this.startCountdown();
        }
        break;

      case 'playing':
      case 'new-question':
        if (this.paused) {
          // Check quit button first
          if (this.hitTest(x, y, this.renderer.getPauseQuitRect())) {
            this.paused = false;
            this.scoreManager.saveHighScore();
            this.restartGame();
          } else {
            this.paused = false;
            this.lastTime = performance.now();
          }
        } else {
          const pr = this.renderer.getPauseButtonRect();
          if (x >= pr.x && x <= pr.x + pr.w && y >= pr.y && y <= pr.y + pr.h) {
            this.paused = true;
          } else if (this.state === 'playing') {
            this.handlePlayTap(x, y);
          }
        }
        break;

      case 'game-over':
        this.restartGame();
        break;
    }
  }

  private handleUserSelectTap(x: number, y: number): void {
    const users = this.userStore.list();
    const layout = this.renderer.getUserSelectLayout(users.length);

    // Check delete toggle
    if (users.length > 0 && this.hitTest(x, y, layout.deleteToggle)) {
      this.deleteMode = !this.deleteMode;
      return;
    }

    // Check user buttons
    for (let i = 0; i < users.length; i++) {
      if (this.hitTest(x, y, layout.userButtons[i])) {
        if (this.deleteMode && this.hitTest(x, y, layout.deleteIcons[i])) {
          this.deleteTarget = users[i];
          this.state = 'confirm-delete';
        } else if (!this.deleteMode) {
          this.selectUser(users[i]);
        }
        return;
      }
    }

    // Check "New User" button
    if (this.hitTest(x, y, layout.newUserButton)) {
      this.nameInput = '';
      this.deleteMode = false;
      this.state = 'name-entry';
    }
  }

  private handleNameEntryTap(x: number, y: number): void {
    const keys = this.renderer.getKeypadLayout();
    for (const key of keys) {
      if (x >= key.x && x <= key.x + key.w && y >= key.y && y <= key.y + key.h) {
        if (key.label === '⌫') {
          this.nameInput = this.nameInput.slice(0, -1);
        } else if (key.label === 'OK') {
          if (this.nameInput.length > 0) {
            this.finishNameEntry();
          }
        } else if (this.nameInput.length < CONFIG.MAX_USERNAME_LENGTH) {
          this.nameInput += key.label;
        }
        return;
      }
    }
  }

  private finishNameEntry(): void {
    const name = this.nameInput.trim().toUpperCase();
    if (!name) return;

    const existing = this.userStore.get(name);
    if (existing) {
      this.selectUser(existing);
    } else {
      try {
        const profile = this.userStore.create(name);
        this.selectUser(profile);
      } catch {
        // Name conflict after normalization — just go back
        this.state = 'user-select';
      }
    }
  }

  private handleDeleteConfirmTap(x: number, y: number): void {
    const layout = this.renderer.getDeleteConfirmLayout();

    if (this.hitTest(x, y, layout.cancelBtn)) {
      this.deleteTarget = null;
      this.state = 'user-select';
    } else if (this.hitTest(x, y, layout.deleteBtn)) {
      if (this.state === 'confirm-delete') {
        this.state = 'confirm-delete-final';
      } else {
        // Final confirmation — delete the user
        if (this.deleteTarget) {
          this.userStore.delete(this.deleteTarget.name);
          this.deleteTarget = null;
        }
        this.deleteMode = false;
        this.state = 'user-select';
      }
    }
  }

  private selectUser(profile: UserProfile): void {
    this.currentUser = profile;
    this.scoreManager = new ScoreManager(this.userStore, profile);
    this.state = 'op-picker';
  }

  private hitTest(
    x: number,
    y: number,
    rect: { x: number; y: number; w: number; h: number },
  ): boolean {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  private handleOpPickerTap(x: number, y: number): void {
    if (!this.currentUser) return;
    const layout = this.renderer.getOpPickerLayout();
    const allOps = CONFIG.OP_ORDER;

    for (let i = 0; i < allOps.length; i++) {
      if (this.hitTest(x, y, layout.opButtons[i])) {
        const op = allOps[i] as Operation;
        if (this.currentUser.progress[op].unlockedLevel === 0) return; // locked
        this.selectedOp = op;
        this.state = 'level-picker';
        return;
      }
    }
  }

  private handleLevelPickerTap(x: number, y: number): void {
    if (!this.currentUser) return;
    const layout = this.renderer.getLevelPickerLayout();
    const progress = this.currentUser.progress[this.selectedOp];

    for (let i = 0; i < CONFIG.LEVELS_PER_OP; i++) {
      if (this.hitTest(x, y, layout.levelButtons[i])) {
        const lvl = i + 1;
        if (lvl > progress.unlockedLevel) return; // locked
        this.selectedLevel = lvl;
        this.scoreManager.setActiveLevel(this.selectedOp, this.selectedLevel);
        this.state = 'start';
        return;
      }
    }
  }

  private startCountdown(): void {
    this.state = 'countdown';
    this.countdownValue = CONFIG.COUNTDOWN_SECONDS;
    this.countdownTimer = 1;
    this.scoreManager.reset();
  }

  private handlePlayTap(x: number, y: number): void {
    if (!this.question) return;

    for (const shape of this.shapes) {
      if (!shape.alive) continue;
      if (!shape.containsPoint(x, y)) continue;

      if (shape.answer === this.question.answer) {
        // Correct! — bonus points for answering higher up (#6)
        shape.triggerPop();
        this.renderer.spawnParticles(shape.x, shape.y, shape.color);
        const screenH = this.renderer.getHeight();
        const heightRatio = Math.min(1, Math.max(0, 1 - shape.y / screenH));
        const bonus = Math.round(heightRatio * CONFIG.CORRECT_BONUS_MAX);
        const leveledUp = this.scoreManager.addCorrect(bonus);
        this.audio.correct();
        if (leveledUp) {
          this.audio.levelUp();
        }

        // Check for unlock
        const unlock = this.scoreManager.checkUnlock();
        if (unlock) {
          // Refresh current user data
          this.currentUser = this.userStore.get(this.currentUser!.name) ?? this.currentUser;
          this.celebrationMessage = unlock.message;
          this.celebrationTimer = CONFIG.CELEBRATION_DURATION_MS / 1000;
          this.state = 'celebration';
          this.audio.levelUp();
          // Big particle burst
          this.renderer.spawnParticles(this.renderer.getWidth() / 2, this.renderer.getHeight() / 2, '#feca57', 30);
          // Fade out shapes
          for (const s of this.shapes) s.alive = false;
        } else {
          // Move to next question after delay
          this.state = 'new-question';
          this.newQuestionTimer = CONFIG.NEW_QUESTION_DELAY_MS / 1000;
          // Fade out remaining shapes
          for (const s of this.shapes) {
            if (s !== shape) s.alive = false;
          }
        }
      } else {
        // Wrong!
        shape.triggerShake();
        this.scoreManager.addWrong();
        this.audio.wrong();
        this.wrongCount++;
        if (this.wrongCount >= CONFIG.MAX_WRONG_PER_QUESTION) {
          this.endGame();
        }
      }
      return; // only process first hit
    }
  }

  private nextQuestion(): void {
    this.wrongCount = 0;
    this.question = createQuestion(this.selectedOp, this.selectedLevel);
    const speed = this.scoreManager.getFallSpeed(this.isAllComplete());
    this.shapes = spawnShapes(this.question.choices, this.renderer.getWidth(), speed, this.renderer.getScale());
  }

  private endGame(): void {
    this.state = 'game-over';
    this.scoreManager.saveHighScore();
    this.audio.gameOver();
  }

  private restartGame(): void {
    if (this.currentUser) {
      // Refresh user data (may have new unlocks)
      this.currentUser = this.userStore.get(this.currentUser.name) ?? this.currentUser;
      this.scoreManager = new ScoreManager(this.userStore, this.currentUser);
      this.state = 'op-picker';
    } else {
      this.state = 'user-select';
    }
    this.deleteMode = false;
  }
}
