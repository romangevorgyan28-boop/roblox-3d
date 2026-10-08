# 🎮 Игровой Hub (3 игры: Brookhaven / Cheese / Shooter / Brainrot)

Three.js клиент (index.html) + Node.js WebSocket сервер (server.js).

## Запуск
```bash
npm install        # ставит ws и express
node server.js     # открой http://localhost:3000
```

## Управление
- **ПК**: WASD/стрелки, мышь (клик — захват курсора), ЛКМ — огонь (можно удерживать), Shift — спринт, E — действие, T — чат, Esc — меню
- **Телефон**: левый джойстик — движение, правая зона — обзор, кнопки 🔫 (автоогонь при удержании), 💨 бег, 💥 удар, 💬 чат, ⚙️ настройки

## Публикация на GitHub
1. github.com → New repository → создай пустой репозиторий (например `game-hub`)
2. В терминале в папке проекта:
```bash
git init
git add .
git commit -m "v6.0"
git branch -M main
git remote add origin https://github.com/USERNAME/game-hub.git
git push -u origin main
```
