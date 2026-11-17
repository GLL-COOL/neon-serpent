// 排行榜：有設定 Firebase 時用 Firestore（全球），沒有時退回本機 localStorage。
// 資料結構：leaderboards/{mode}/scores/{uid}，每位玩家每個模式只保留最佳成績。
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
  function scoresCol(mode) {
    return fs.collection(db, 'leaderboards', mode, 'scores');
  }

  LB.top = async function (mode, n = 20) {
    await LB.ready;
    if (!LB.online) {
      return (localLoad()[mode] || []).slice(0, n).map(e => ({ ...e, mine: true }));
    }
    const snap = await fs.getDocs(fs.query(scoresCol(mode), fs.orderBy('score', 'desc'), fs.limit(n)));
    return snap.docs.map(d => ({ ...d.data(), mine: d.id === LB.uid }));
  };

  // entry: { name, score, length, durationMs }
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
      data[mode] = list.slice(0, 20);
      localSave(data);
      const rank = list.indexOf(row) + 1;
      return { online: false, rank, best: clean.score, improved: true };
    }

    const ref = fs.doc(db, 'leaderboards', mode, 'scores', LB.uid);
    const cur = await fs.getDoc(ref);
    let best = clean.score;
    let improved = true;
    if (cur.exists() && cur.data().score >= clean.score) {
      best = cur.data().score;
      improved = false;
    } else {
      await fs.setDoc(ref, {
        uid: LB.uid,
        mode,
        ...clean,
        updatedAt: fs.serverTimestamp(),
      });
    }
    const higher = await fs.getCountFromServer(fs.query(scoresCol(mode), fs.where('score', '>', best)));
    return { online: true, rank: higher.data().count + 1, best, improved };
  };
})();
