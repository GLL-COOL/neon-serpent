# 霓虹蛇：Firebase 設定與上線

## 1. 建立 Firebase 專案（約 5 分鐘）

1. 打開 https://console.firebase.google.com ，按「新增專案」，取個名字（例如 `neon-serpent`）。Google Analytics 可以關掉。
2. **開啟匿名登入**：左側「建構 → Authentication → 開始使用 → 登入方式」，選「匿名」，啟用，儲存。
3. **建立資料庫**：左側「建構 → Firestore Database → 建立資料庫」
   - 位置選 `asia-east1 (台灣)`
   - 選「以正式版模式啟動」
4. **貼上安全規則**：Firestore Database →「規則」分頁，把整份 [firestore.rules](firestore.rules) 的內容貼上，按「發布」。
5. **取得網頁設定**：左上齒輪 →「專案設定」→ 往下到「你的應用程式」，按 `</>`（網頁），隨便取個暱稱註冊（不用勾 Hosting）。
   畫面會出現一段 `const firebaseConfig = { ... }`，把它貼到 [firebase-config.js](firebase-config.js) 裡（或直接貼給 Claude）。

> `apiKey` 這些值本來就會出現在公開網頁上，不是密碼。保護資料的是第 4 步的規則。

## 2. 上線（擇一）

### A. Firebase Hosting（網址：`你的專案.web.app`）
需要先安裝 Node.js（https://nodejs.org 下載 LTS 安裝檔）。之後在這個資料夾執行：

```bash
npx firebase-tools login
npx firebase-tools use --add          # 選你的專案
npx firebase-tools deploy --only hosting,firestore:rules
```

### B. Netlify Drop（不用安裝任何東西）
1. 打開 https://app.netlify.com/drop ，把整個 `1117` 資料夾拖進去，就會拿到一個公開網址。
2. 回到 Firebase：「Authentication → 設定 → 授權網域」，把 Netlify 給你的網域（例如 `xxx.netlify.app`）加進去，不然匿名登入會被擋。

## 3. 本機測試

```bash
python3 -m http.server 8000
```
然後打開 http://localhost:8000 。右上角顯示「全球排行」就代表連上 Firebase 了。
