/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LearningState, saveState } from './page-learning-state';
import { SVG } from './svg-icons';
import { html, render } from './render';

export function renderSnakeGame(container: HTMLElement, state: LearningState, onBack: () => void): void {
  const GRID = 20;
  const CELL = 16;
  const SIZE = GRID * CELL;

  render(html`
    <div class="learn-snake-wrap">
      <div class="learn-snake-header">
        <h3>${SVG.snake} Snake Reward</h3>
        <p>Earned by getting 5 correct answers in a row. Arrow keys to play.</p>
        <div class="learn-snake-scores">
          <span>High Score: <strong id="snake-high">${state.snakeHighScore}</strong></span>
          <span>Score: <strong id="snake-score">0</strong></span>
        </div>
      </div>
      <canvas id="snake-canvas" width=${SIZE} height=${SIZE} tabindex="0"></canvas>
      <button class="btn btn-secondary" id="snake-back">${SVG.arrowLeft} Back</button>
    </div>`, container);

  const canvas = document.getElementById('snake-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const scoreEl = document.getElementById('snake-score')!;
  const highEl = document.getElementById('snake-high')!;

  let snake = [{ x: 10, y: 10 }];
  let dir = { x: 1, y: 0 };
  let food = spawnFood();
  let score = 0;
  let gameOver = false;

  function spawnFood(): { x: number; y: number } {
    let pos: { x: number; y: number };
    do {
      pos = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
    } while (snake.some(segment => segment.x === pos.x && segment.y === pos.y));
    return pos;
  }

  function draw(): void {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= GRID; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(SIZE, i * CELL); ctx.stroke();
    }
    ctx.fillStyle = '#f85149';
    ctx.beginPath();
    ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < snake.length; i++) {
      const pct = 1 - i / snake.length;
      ctx.fillStyle = `rgb(59, ${Math.round(185 + pct * 70)}, 80)`;
      ctx.fillRect(snake[i].x * CELL + 1, snake[i].y * CELL + 1, CELL - 2, CELL - 2);
    }
    if (gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = '#f85149';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Game Over!', SIZE / 2, SIZE / 2 - 10);
      ctx.fillStyle = '#8b949e';
      ctx.font = '14px sans-serif';
      ctx.fillText(`Score: ${score}  |  Press Space to restart`, SIZE / 2, SIZE / 2 + 20);
    }
  }

  function tick(): void {
    if (gameOver) return;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID) {
      endGame();
      return;
    }
    if (snake.some(segment => segment.x === head.x && segment.y === head.y)) {
      endGame();
      return;
    }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score++;
      scoreEl.textContent = String(score);
      food = spawnFood();
    } else {
      snake.pop();
    }
    draw();
  }

  function endGame(): void {
    gameOver = true;
    if (score > state.snakeHighScore) {
      state.snakeHighScore = score;
      highEl.textContent = String(score);
      saveState(state);
    }
    draw();
  }

  canvas.focus();
  canvas.addEventListener('keydown', (event) => {
    if (gameOver && event.key === ' ') {
      snake = [{ x: 10, y: 10 }];
      dir = { x: 1, y: 0 };
      food = spawnFood();
      score = 0;
      gameOver = false;
      scoreEl.textContent = '0';
      return;
    }
    switch (event.key) {
      case 'ArrowUp': if (dir.y === 0) dir = { x: 0, y: -1 }; break;
      case 'ArrowDown': if (dir.y === 0) dir = { x: 0, y: 1 }; break;
      case 'ArrowLeft': if (dir.x === 0) dir = { x: -1, y: 0 }; break;
      case 'ArrowRight': if (dir.x === 0) dir = { x: 1, y: 0 }; break;
    }
    event.preventDefault();
  });

  draw();
  const interval = setInterval(tick, 120);
  document.getElementById('snake-back')?.addEventListener('click', () => {
    clearInterval(interval);
    onBack();
  });
  (container as unknown as Record<string, unknown>).__snakeInterval = interval;

  // Clean up interval when webview is disposed
  window.addEventListener('unload', () => clearInterval(interval));
}