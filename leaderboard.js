// 排行榜：有設定 Firebase 時用 Firestore（全球），沒有時退回本機 localStorage。
// 資料結構：
//   leaderboards/{mode}/runs/{自動 id}：每一局一筆
//   players/{uid}：記錄上次上傳時間，安全規則用它擋掉狂刷
(function () {
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const LOCAL_KEY = 'serpent-local-board';
  const cfg = window.FIREBASE_CONFIG || {};
  const configured = Boolean(cfg.apiKey && cfg.projectId);

  const LB = { online: false, configured, uid: null, status: 'connecting', error: null };
  window.Leaderboard = LB;

  let fs = null;
  let db = null;

  LB.ready = (async () => {
    if (!configured) {
      LB.status = 'offline';
      return false;
    }
    try {
      const [appM, authM, fsM] = await Promise.all([
        import(SDK + 'firebase-app.js'),
        import(SDK + 'firebase-auth.js'),
        import(SDK + 'firebase-firestore.js'),
      ]);
      const app = appM.initializeApp(cfg);
      const auth = authM.getAuth(app);
      const cred = await authM.signInAnonymously(auth);
      LB.uid = cred.user.uid;
      fs = fsM;
      db = fsM.getFirestore(app);
      LB.online = true;
      LB.status = 'online';
      return true;
    } catch (e) {
      console.error('[Leaderboard] Firebase 連線失敗，改用本機排行榜：', e);
      LB.error = e;
      LB.status = 'error';
      return false;
    }
  })();

  // ---------- 本機備援 ----------
  function localLoad() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function localSave(data) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  // ---------- 公開 API ----------
  function runsCol(mode) {
    return fs.collection(db, 'leaderboards', mode, 'runs');
  }

  LB.top = async function (mode, n = 20) {
    await LB.ready;
    if (!LB.online) {
      return (localLoad()[mode] || []).slice(0, n).map(e => ({ ...e, id: String(e.at), mine: true }));
    }
    const snap = await fs.getDocs(fs.query(runsCol(mode), fs.orderBy('score', 'desc'), fs.limit(n)));
    return snap.docs.map(d => ({ ...d.data(), id: d.id, mine: d.data().uid === LB.uid }));
  };

  // entry: { name, score, length, durationMs }
  // 回傳 { online, rank, id }：rank 是這一局在該模式的名次
  LB.submit = async function (mode, entry) {
    await LB.ready;
    const clean = {
      name: String(entry.name).trim().slice(0, 12),
      score: Math.floor(entry.score),
      length: Math.floor(entry.length),
      durationMs: Math.round(entry.durationMs),
    };

    if (!LB.online) {
      const data = localLoad();
      const list = data[mode] || [];
      const row = { ...clean, at: Date.now() };
      list.push(row);
      list.sort((a, b) => b.score - a.score || a.at - b.at);
      data[mode] = list.slice(0, 50);
      localSave(data);
      return { online: false, rank: list.indexOf(row) + 1, id: String(row.at) };
    }

    // 同一批次寫入：這一局的成績 + 更新「上次上傳時間」，規則會檢查兩者一致
    const ref = fs.doc(runsCol(mode));
    const batch = fs.writeBatch(db);
    batch.set(ref, { uid: LB.uid, mode, ...clean, createdAt: fs.serverTimestamp() });
    batch.set(fs.doc(db, 'players', LB.uid), { lastAt: fs.serverTimestamp() });
    await batch.commit();

    const higher = await fs.getCountFromServer(fs.query(runsCol(mode), fs.where('score', '>', clean.score)));
    return { online: true, rank: higher.data().count + 1, id: ref.id };
  };
})();
