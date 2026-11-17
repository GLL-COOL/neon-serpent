# 霓虹蛇 Neon Serpent

用 [p5.js](https://p5js.org) 做的貪吃蛇遊戲，排行榜用 Firebase Firestore 存。

**線上試玩：https://neon-serpent-cquvw.web.app**

## 特色

- **三種模式**：經典（撞牆就結束）、穿牆（從一邊出去另一邊回來）、迷宮（有固定障礙物），每種模式各有一個排行榜
- **連擊計分**：3 秒內連續吃到可以累積倍率，最高 x5
- **道具**：金蘋果（+5，限時出現）、冰晶（減速 5 秒）、幽靈（穿過自己 5 秒）
- 平滑移動、粒子特效、音效、手機滑動操作
- **全球排行榜**：玩家不用註冊，背後用匿名登入；每位玩家每種模式只保留最佳成績

## 操作

| 按鍵 | 功能 |
|---|---|
| 方向鍵 / WASD / 滑動 | 移動 |
| 空白鍵 / P | 暫停 |
| Enter | 開始、再玩一次 |
| Esc | 回主選單 |
| M | 靜音 |
| L | 排行榜 |

## 自己架一份

1. 把 `firebase-config.example.js` 複製成 `firebase-config.js`，填入你自己 Firebase 專案的設定。
2. 照 [SETUP.md](SETUP.md) 開啟匿名登入、建立 Firestore，並部署 [firestore.rules](firestore.rules)。
3. 在本機執行 `python3 -m http.server 8000`，打開 http://localhost:8000 。

沒有填 `firebase-config.js` 也能玩，排行榜會改存在瀏覽器裡。

## 檔案

| 檔案 | 用途 |
|---|---|
| `sketch.js` | 遊戲主程式 |
| `leaderboard.js` | 排行榜（Firestore；沒有設定時改用本機） |
| `firestore.rules` | 安全規則：只能寫入自己的成績、分數只能往上、檢查分數是否合理 |
| `firebase.json` | Firebase Hosting 部署設定 |
