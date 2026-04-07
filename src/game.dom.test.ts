// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import 'jest-canvas-mock';
import { Game } from './game';

function setWindowSize(w: number, h: number, dpr = 1): void {
  Object.defineProperty(window, 'innerWidth', { value: w, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, writable: true, configurable: true });
  Object.defineProperty(window, 'devicePixelRatio', { value: dpr, writable: true, configurable: true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGame = any;

describe('Game state machine', () => {
  let game: AnyGame;

  beforeEach(() => {
    localStorage.clear();
    setWindowSize(800, 600, 1);
    const canvas = document.createElement('canvas');
    game = new Game(canvas);
  });

  it('initial state is user-select', () => {
    expect(game.state).toBe('user-select');
  });

  it('tapping "New Player" transitions to name-entry', () => {
    const layout = game.renderer.getUserSelectLayout(0);
    const btn = layout.newUserButton;
    game.handleTap(btn.x + btn.w / 2, btn.y + btn.h / 2);
    expect(game.state).toBe('name-entry');
  });

  it('back button on name-entry returns to user-select', () => {
    // Go to name-entry first
    const layout = game.renderer.getUserSelectLayout(0);
    const btn = layout.newUserButton;
    game.handleTap(btn.x + btn.w / 2, btn.y + btn.h / 2);
    expect(game.state).toBe('name-entry');

    // Tap back button
    const backBtn = game.renderer.getBackButtonRect();
    game.handleTap(backBtn.x + backBtn.w / 2, backBtn.y + backBtn.h / 2);
    expect(game.state).toBe('user-select');
  });

  it('entering a name and pressing OK transitions to op-picker', () => {
    // Go to name-entry
    const layout = game.renderer.getUserSelectLayout(0);
    const newBtn = layout.newUserButton;
    game.handleTap(newBtn.x + newBtn.w / 2, newBtn.y + newBtn.h / 2);
    expect(game.state).toBe('name-entry');

    // Type "AB" via keypad
    const keys = game.renderer.getKeypadLayout();
    const keyA = keys.find((k: { label: string }) => k.label === 'A')!;
    const keyB = keys.find((k: { label: string }) => k.label === 'B')!;
    const keyOK = keys.find((k: { label: string }) => k.label === 'OK')!;

    game.handleTap(keyA.x + keyA.w / 2, keyA.y + keyA.h / 2);
    game.handleTap(keyB.x + keyB.w / 2, keyB.y + keyB.h / 2);
    expect(game.nameInput).toBe('AB');

    game.handleTap(keyOK.x + keyOK.w / 2, keyOK.y + keyOK.h / 2);
    expect(game.state).toBe('op-picker');
  });

  it('back button on op-picker returns to user-select', () => {
    // Go to name-entry → enter name → op-picker
    const layout = game.renderer.getUserSelectLayout(0);
    const newBtn = layout.newUserButton;
    game.handleTap(newBtn.x + newBtn.w / 2, newBtn.y + newBtn.h / 2);

    const keys = game.renderer.getKeypadLayout();
    const keyA = keys.find((k: { label: string }) => k.label === 'A')!;
    const keyOK = keys.find((k: { label: string }) => k.label === 'OK')!;
    game.handleTap(keyA.x + keyA.w / 2, keyA.y + keyA.h / 2);
    game.handleTap(keyOK.x + keyOK.w / 2, keyOK.y + keyOK.h / 2);
    expect(game.state).toBe('op-picker');

    // Tap back button
    const backBtn = game.renderer.getBackButtonRect();
    game.handleTap(backBtn.x + backBtn.w / 2, backBtn.y + backBtn.h / 2);
    expect(game.state).toBe('user-select');
  });

  it('backspace removes last character from name input', () => {
    // Go to name-entry
    const layout = game.renderer.getUserSelectLayout(0);
    const newBtn = layout.newUserButton;
    game.handleTap(newBtn.x + newBtn.w / 2, newBtn.y + newBtn.h / 2);

    const keys = game.renderer.getKeypadLayout();
    const keyA = keys.find((k: { label: string }) => k.label === 'A')!;
    const keyB = keys.find((k: { label: string }) => k.label === 'B')!;
    const keyBackspace = keys.find((k: { label: string }) => k.label === '⌫')!;

    game.handleTap(keyA.x + keyA.w / 2, keyA.y + keyA.h / 2);
    game.handleTap(keyB.x + keyB.w / 2, keyB.y + keyB.h / 2);
    expect(game.nameInput).toBe('AB');

    game.handleTap(keyBackspace.x + keyBackspace.w / 2, keyBackspace.y + keyBackspace.h / 2);
    expect(game.nameInput).toBe('A');
  });

  it('OK does nothing when name input is empty', () => {
    // Go to name-entry
    const layout = game.renderer.getUserSelectLayout(0);
    const newBtn = layout.newUserButton;
    game.handleTap(newBtn.x + newBtn.w / 2, newBtn.y + newBtn.h / 2);
    expect(game.state).toBe('name-entry');

    const keys = game.renderer.getKeypadLayout();
    const keyOK = keys.find((k: { label: string }) => k.label === 'OK')!;
    game.handleTap(keyOK.x + keyOK.w / 2, keyOK.y + keyOK.h / 2);
    expect(game.state).toBe('name-entry');
  });

  it('renders gameplay shapes behind the question banner', () => {
    const order: string[] = [];

    game.state = 'playing';
    game.question = { text: '1 + 1', answer: 2, choices: [1, 2, 3, 4] };
    game.scoreManager = { score: 0, highScore: 0, level: 1 };
    game.shapes = [];

    game.renderer.clear = () => { order.push('clear'); };
    game.renderer.drawShapes = () => { order.push('shapes'); };
    game.renderer.drawParticles = () => { order.push('particles'); };
    game.renderer.drawQuestion = () => { order.push('question'); };
    game.renderer.drawHUD = () => { order.push('hud'); };

    game.render();

    expect(order).toEqual(['clear', 'shapes', 'particles', 'question', 'hud']);
  });
});
