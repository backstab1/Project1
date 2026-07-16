class MovieStore {
    constructor() {
        this.movies = JSON.parse(localStorage.getItem('mv_final_movies')) || [];
        this.franchises = JSON.parse(localStorage.getItem('mv_final_franch')) || [];
        this.categories = JSON.parse(localStorage.getItem('mv_final_cats')) || this.seedCats();
        this.saves = JSON.parse(localStorage.getItem('mv_final_saves')) || { "Игрок 1": 3, "Игрок 2": 3 };
        if (this.movies.length === 0) this.seedMovies();
    }

    persist() {
        localStorage.setItem('mv_final_movies', JSON.stringify(this.movies));
        localStorage.setItem('mv_final_franch', JSON.stringify(this.franchises));
        localStorage.setItem('mv_final_cats', JSON.stringify(this.categories));
        localStorage.setItem('mv_final_saves', JSON.stringify(this.saves));
    }

    seedCats() {
        return ["Боевик", "Комедия", "Драма", "Ужасы", "Фантастика", "Триллер", "Фэнтези", "Аниме", "Детектив", "Мультфильм"]
            .map((n, i) => ({ id: (i + 1).toString(), name: n }));
    }

    seedMovies() {
        const data = [
            { t: "Начало", c: "5", img: "https://m.media-amazon.com/images/I/912AErFSBHL._AC_SL1500_.jpg" },
            { t: "Интерстеллар", c: "5", img: "https://m.media-amazon.com/images/I/A1JVqNMI7UL._AC_SL1500_.jpg" },
            { t: "Темный рыцарь", c: "1", img: "https://m.media-amazon.com/images/I/818hy698B4L._AC_SL1500_.jpg" },
            { t: "Леон", c: "1", img: "https://m.media-amazon.com/images/I/71Yp-Iu8slL._AC_SL1125_.jpg" },
            { t: "Криминальное чтиво", c: "1", img: "https://m.media-amazon.com/images/I/91K99shX9DL._AC_SL1500_.jpg" }
        ];
        for (let i = 0; i < 35; i++) {
            data.push({ t: `Кинохит #${i + 6}`, c: (Math.floor(Math.random() * 10) + 1).toString(), img: `https://picsum.photos/seed/${i + 100}/300/450` });
        }
        this.movies = data.map(m => ({
            id: crypto.randomUUID(), title: m.t, catId: m.c, watched: false, inRoll: false, ratings: [], cover: m.img
        }));
        this.persist();
    }

    getAvg(m) {
        if (!m.ratings || m.ratings.length === 0) return "0.0";
        const sum = m.ratings.reduce((a, b) => a + parseFloat(b.value), 0);
        return (sum / m.ratings.length).toFixed(1);
    }
}

const store = new MovieStore();

const UI = {
    view: 'catalog',
    session: { pool: [], elim: [] },

    init() {
        window.UI = UI;
        this.render();
    },

    changeView(v) { this.view = v; this.render(); },

    render() {
        const app = document.getElementById('app');
        const watchedMovies = store.movies.filter(m => m.watched);
        const watchedFranchises = store.franchises.filter(f => f.watched);
        document.getElementById('stats').textContent = `Просмотрено: ${watchedMovies.length + watchedFranchises.length}`;
        app.innerHTML = '';

        if (this.view === 'catalog') this.renderCatalog(app);
        if (this.view === 'categories') this.renderCategories(app);
        if (this.view === 'watched') this.renderHistory(app);
        if (this.view === 'wheel') this.renderWheel(app);
    },

    renderCatalog(container) {
        const movies = store.movies.filter(m => !m.watched && !this.isInFranchise(m.id));
        const franchises = store.franchises.filter(f => !f.watched);
        container.innerHTML = `
            <div style="margin-bottom:20px; display:flex; gap:10px; flex-wrap:wrap;">
                <button class="action btn-accent" onclick="UI.modalAddMovie(false)">+ Фильм</button>
                <button class="action" onclick="UI.modalAddFranchise()">+ Франшиза</button>
                <button class="action" onclick="UI.modalSaves()">Сейвы</button>
            </div>
            <div class="grid">
                ${franchises.map(f => this.drawFranchise(f)).join('')}
                ${movies.map(m => this.drawMovieCard(m)).join('')}
            </div>
        `;
    },

    renderHistory(container) {
        const watchedM = store.movies.filter(m => m.watched && !this.isInFranchise(m.id));
        const watchedF = store.franchises.filter(f => f.watched);
        container.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <h2>История просмотров</h2>
                <button class="action btn-accent" onclick="UI.modalAddMovie(true)">+ В историю (извне)</button>
            </div>
        `;
        if (watchedM.length === 0 && watchedF.length === 0) {
            container.innerHTML += '<div style="text-align:center; padding:50px; opacity:0.5;"><h3>История пуста</h3></div>';
            return;
        }
        container.innerHTML += `
            <div class="grid">
                ${watchedF.map(f => this.drawFranchise(f, true)).join('')}
                ${watchedM.map(m => this.drawMovieCard(m, true)).join('')}
            </div>
        `;
    },

    isInFranchise(id) { return store.franchises.some(f => f.movieIds.includes(id)); },

    drawMovieCard(m, isHistory = false) {
        const cat = store.categories.find(c => c.id === m.catId)?.name || 'Общее';
        return `
            <div class="card">
                <img src="${m.cover}" alt="">
                <div class="card-content">
                    <div style="display:flex; justify-content:space-between; align-items:start;">
                        <small style="color:var(--emerald); font-weight:bold;">${cat}</small>
                        <button class="action btn-del" style="padding:2px 6px; font-size:10px;" onclick="UI.deleteMovie('${m.id}')">Удалить</button>
                    </div>
                    <h3 style="margin:8px 0; font-size:1.1rem;">${m.title}</h3>
                    ${isHistory ? `<div style="color:var(--emerald); font-size:1.2rem; font-weight:bold; margin-bottom:10px;">⭐ ${store.getAvg(m)}</div>` : ''}
                    <div style="margin-top:auto; display:flex; gap:5px;">
                        ${!isHistory ? 
                            `<button class="action" style="width:100%" onclick="UI.toggleRoll('${m.id}')">${m.inRoll ? '❌ Убрать' : '🎲 В ролл'}</button>` : 
                            `<button class="action" style="width:100%" onclick="UI.modalRate('${m.id}')">Оценить</button>`}
                    </div>
                    ${isHistory && m.ratings.length ? `<div style="font-size:0.75rem; margin-top:10px; padding-top:10px; border-top:1px solid #333; opacity:0.7;">${m.ratings.map(r => `<b>${r.u}:</b> ${r.value}`).join(' | ')}</div>` : ''}
                </div>
            </div>
        `;
    },

    drawFranchise(f, isHistory = false) {
        const fMovies = store.movies.filter(m => f.movieIds.includes(m.id));
        const avg = fMovies.length ? (fMovies.reduce((a, b) => a + parseFloat(store.getAvg(b)), 0) / fMovies.length).toFixed(1) : "0.0";
        return `
            <div class="card" style="border: 1px solid var(--emerald)">
                <div class="card-content">
                    <div style="display:flex; justify-content:space-between;">
                        <small style="color:var(--emerald)">📂 ФРАНШИЗА</small>
                        <button class="action btn-del" style="padding:2px 6px; font-size:10px;" onclick="UI.deleteFranchise('${f.id}')">Удалить</button>
                    </div>
                    <h3 style="margin:10px 0">${f.name}</h3>
                    <div style="color:var(--emerald); font-size:1.2rem; font-weight:bold;">⭐ ${avg}</div>
                    
                    <div style="margin-top:auto; display:flex; flex-direction:column; gap:8px;">
                        ${!isHistory ? `
                            <button class="action" style="width:100%" onclick="UI.toggleRoll('${f.id}')">${f.inRoll ? '❌ Убрать' : '🎲 В ролл'}</button>
                            <button class="action" onclick="UI.modalAddToFranchise('${f.id}')">+ Добавить фильм</button>
                        ` : `
                            <button class="action" style="width:100%" onclick="UI.modalRateFranchise('${f.id}')">Оценить фильмы</button>
                        `}
                    </div>
                    <div style="font-size:0.7rem; margin-top:15px; opacity:0.6;">${fMovies.map(m => m.title).join(' • ')}</div>
                </div>
            </div>
        `;
    },

    /* --- МОДАЛЬНЫЕ ОКНА --- */
    modalRate(id) {
        this.showModal("Оценка", `<input id="r-u" placeholder="Имя"><input id="r-v" type="number" step="0.1" min="1" max="10" placeholder="Оценка (1-10)">`, () => {
            const u = document.getElementById('r-u').value;
            let v = parseFloat(document.getElementById('r-v').value);
            if (u && !isNaN(v)) {
                v = Math.min(10, Math.max(1, v));
                const m = store.movies.find(x => x.id === id);
                if (m) { m.ratings.push({u, value: v}); store.persist(); UI.render(); }
            }
        });
    },

    modalRateFranchise(fid) {
        const f = store.franchises.find(x => x.id === fid);
        const fMovies = store.movies.filter(m => f.movieIds.includes(m.id));
        const movieOptions = fMovies.map(m => `<option value="${m.id}">${m.title}</option>`).join('');
        
        this.showModal(`Оценить: ${f.name}`, `
            <select id="rf-mid">${movieOptions}</select>
            <input id="rf-u" placeholder="Имя">
            <input id="rf-v" type="number" step="0.1" min="1" max="10" placeholder="Оценка (1-10)">
        `, () => {
            const mid = document.getElementById('rf-mid').value;
            const u = document.getElementById('rf-u').value;
            let v = parseFloat(document.getElementById('rf-v').value);
            if (mid && u && !isNaN(v)) {
                v = Math.min(10, Math.max(1, v));
                const m = store.movies.find(x => x.id === mid);
                m.ratings.push({u, value: v});
                store.persist(); UI.render();
            }
        });
    },

    modalAddMovie(isWatched) {
        const cats = store.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        this.showModal(isWatched ? "В историю" : "Новый фильм", `<input id="m-t" placeholder="Название"><input id="m-i" placeholder="URL обложки"><select id="m-c">${cats}</select>`, () => {
            const t = document.getElementById('m-t').value;
            const i = document.getElementById('m-i').value || 'https://via.placeholder.com/300x450?text=No+Cover';
            const c = document.getElementById('m-c').value;
            if (t) {
                store.movies.push({id:crypto.randomUUID(), title:t, cover:i, catId:c, watched:isWatched, inRoll:false, ratings:[], watchedAt: isWatched ? new Date().toISOString() : null});
                store.persist(); this.render();
            }
        });
    },

    modalSaveMovie(idx) {
        const users = Object.keys(store.saves).filter(k => store.saves[k] > 0);
        if(!users.length) { alert("Сейвы закончились!"); return; }
        const opts = users.map(u => `<option value="${u}">${u} (${store.saves[u]})</option>`).join('');
        this.showModal("Кто использует сейв?", `<select id="s-u">${opts}</select>`, () => {
            const u = document.getElementById('s-u').value;
            store.saves[u]--; store.persist(); this.render();
        });
    },

    modalAddCategory() {
        this.showModal("Новая категория", `<input id="c-n" placeholder="Название">`, () => {
            const n = document.getElementById('c-n').value;
            if(n) { store.categories.push({id:Date.now().toString(), name:n}); store.persist(); this.render(); }
        });
    },

    modalAddFranchise() {
        this.showModal("Новая франшиза", `<input id="f-t" placeholder="Название">`, () => {
            const t = document.getElementById('f-t').value;
            if(t) { store.franchises.push({id:crypto.randomUUID(), name:t, movieIds:[], inRoll:false, watched:false}); store.persist(); this.render(); }
        });
    },

    modalAddToFranchise(fid) {
        const free = store.movies.filter(m => !this.isInFranchise(m.id));
        const opts = free.map(m => `<option value="${m.id}">${m.title}</option>`).join('');
        this.showModal("Добавить фильм", `<select id="f-sel">${opts}</select>`, () => {
            const mid = document.getElementById('f-sel').value;
            if(mid) { store.franchises.find(f => f.id === fid).movieIds.push(mid); store.persist(); this.render(); }
        });
    },

    modalSaves() {
        const list = Object.entries(store.saves).map(([u, c]) => `<div>${u}: ${c} <button onclick="UI.deletePlayer('${u}')" style="color:red; background:none; border:none; cursor:pointer;">(х)</button></div>`).join('');
        this.showModal("Сейвы", `<div style="margin-bottom:10px">${list}</div><input id="s-n" placeholder="Имя"><input id="s-c" type="number" value="3">`, () => {
            const n = document.getElementById('s-n').value; const c = parseInt(document.getElementById('s-c').value);
            if(n) { store.saves[n] = c; store.persist(); this.render(); }
        });
    },

    showModal(title, body, onOk) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = body;
        document.getElementById('modal-overlay').classList.remove('hidden');
        document.getElementById('modal-ok-btn').onclick = () => { onOk(); this.closeModal(); };
    },
    closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); },

    /* --- ДЕЙСТВИЯ --- */
    toggleRoll(id) {
        const m = store.movies.find(x => x.id === id);
        const f = store.franchises.find(x => x.id === id);
        if (m) m.inRoll = !m.inRoll;
        if (f) f.inRoll = !f.inRoll;
        store.persist(); this.render();
    },

    shufflePool() { this.session.pool.sort(() => Math.random() - 0.5); this.render(); },
    restartSession() { if(confirm("Сбросить ролл?")) { this.session = { pool: [], elim: [] }; this.render(); } },
    
    batchRoll(cid) {
        const val = parseInt(document.getElementById(`cat-in-${cid}`).value);
        const mvs = store.movies.filter(m => m.catId === cid && !m.watched);
        mvs.forEach(m => m.inRoll = false);
        mvs.slice(0, val).forEach(m => m.inRoll = true);
        store.persist(); this.render();
    },

    renderCategories(container) {
        container.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;"><h2>Категории</h2><button class="action btn-accent" onclick="UI.modalAddCategory()">+ Создать категорию</button></div>`;
        store.categories.forEach(cat => {
            const movies = store.movies.filter(m => m.catId === cat.id && !m.watched);
            container.innerHTML += `
                <div class="cat-item">
                    <div class="cat-head" onclick="this.nextElementSibling.classList.toggle('hidden')">
                        <span><b>${cat.name}</b> (${movies.length})</span>
                        <button class="action btn-del" style="padding:4px 10px;" onclick="event.stopPropagation(); UI.deleteCategory('${cat.id}')">🗑</button>
                    </div>
                    <div class="cat-content hidden">
                        <div style="margin-bottom:15px; background:var(--bg-dark); padding:10px; border-radius:10px;">
                            Взять по порядку: <input type="number" id="cat-in-${cat.id}" value="0" style="width:60px; margin:0 10px;">
                            <button class="action btn-accent" onclick="UI.batchRoll('${cat.id}')">Применить</button>
                        </div>
                        <div style="display:flex; flex-wrap:wrap; gap:8px;">
                            ${movies.map(m => `<span style="padding:4px 8px; border-radius:6px; background:${m.inRoll ? 'rgba(46,204,113,0.2)' : 'var(--bg-light)'}; color:${m.inRoll ? 'var(--emerald)' : 'inherit'}">${m.inRoll ? '✅' : ''} ${m.title}</span>`).join('')}
                        </div>
                    </div>
                </div>
            `;
        });
    },

    renderWheel(container) {
        if (this.session.pool.length === 0) {
            const poolM = store.movies.filter(m => m.inRoll && !m.watched && !this.isInFranchise(m.id));
            const poolF = store.franchises.filter(f => f.inRoll && !f.watched);
            this.session.pool = [...poolM, ...poolF.map(f => ({...f, title: "📁 " + f.name}))];
            this.session.elim = [];
        }
        if (this.session.pool.length < 2) {
            container.innerHTML = '<div style="text-align:center; padding:50px;"><h2>Выберите минимум 2 объекта в ролл</h2></div>';
            return;
        }
        container.innerHTML = `
            <div style="display:grid; grid-template-columns: 1fr 350px; gap:40px;">
                <div style="text-align:center">
                    <div class="wheel-wrap"><div class="wheel-arrow"></div><canvas id="wheel-canvas" width="500" height="500"></canvas></div>
                    <div id="w-actions" style="margin-top:25px; display:flex; justify-content:center; gap:12px;">
                        <button class="action btn-accent" style="padding:15px 40px;" onclick="UI.spin()">КРУТИТЬ</button>
                    </div>
                    <h2 id="w-status" style="margin-top:20px; color:var(--emerald);"></h2>
                </div>
                <div>
                    <div style="background:var(--bg-card); padding:20px; border-radius:20px; border:1px solid var(--emerald); margin-bottom:20px;">
                        <b>🛡 СЕЙВЫ:</b><br>${Object.entries(store.saves).map(([u, c]) => `<span>${u}: <b>${c}</b></span>`).join(' | ')}
                    </div>
                    <div class="elim-log" id="w-log">${this.session.elim.map(m => `<div style="padding:8px; color:var(--red); text-decoration:line-through; border-bottom:1px solid #222;">${m.title}</div>`).join('')}</div>
                </div>
            </div>
        `;
        this.drawWheel();
    },

    drawWheel(off = 0) {
        const canvas = document.getElementById('wheel-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const p = this.session.pool;
        const arc = (Math.PI * 2) / p.length;
        ctx.clearRect(0,0,500,500);
        p.forEach((m, i) => {
            ctx.beginPath(); ctx.fillStyle = i % 2 ? '#2ecc71' : '#161b22'; ctx.moveTo(250,250);
            ctx.arc(250,250,250, i*arc+off, (i+1)*arc+off); ctx.fill();
            ctx.save(); ctx.translate(250,250); ctx.rotate(i*arc+arc/2+off);
            ctx.fillStyle = i % 2 ? '#0d1117' : '#fff'; ctx.font = "bold 13px sans-serif";
            ctx.textAlign = "right"; ctx.fillText((m.title || m.name).substring(0, 18), 230, 5); ctx.restore();
        });
    },

    spin() {
        const btn = document.querySelector('#w-actions button');
        const status = document.getElementById('w-status');
        btn.disabled = true;
        const duration = 3000; const start = performance.now();
        const rot = Math.PI * 2 * 10 + (Math.random() * Math.PI * 2);
        const anim = (now) => {
            const ease = 1 - Math.pow(1 - Math.min((now-start)/duration, 1), 3);
            this.drawWheel(rot * ease);
            if (ease < 1) requestAnimationFrame(anim);
            else {
                const final = (rot * ease) % (Math.PI * 2);
                const arc = (Math.PI * 2) / this.session.pool.length;
                const idx = this.session.pool.length - 1 - Math.floor(final / arc);
                const loser = this.session.pool[idx];
                status.innerHTML = `Выбывает: <span style="color:var(--red)">${loser.title || loser.name}</span>`;
                document.getElementById('w-actions').innerHTML = `<button class="action btn-accent" onclick="UI.confirmElim(${idx})">ПРИНЯТЬ</button>`;
            }
        };
        requestAnimationFrame(anim);
    },

    confirmElim(idx) {
        const item = this.session.pool.splice(idx, 1)[0];
        this.session.elim.unshift(item);
        if (this.session.pool.length === 1) {
            const winner = this.session.pool[0];
            const dbMovie = store.movies.find(x => x.id === winner.id);
            const dbFranch = store.franchises.find(x => x.id === winner.id);

            if (dbMovie) {
                dbMovie.watched = true;
                dbMovie.watchedAt = new Date().toISOString();
            } else if (dbFranch) {
                dbFranch.watched = true;
                dbFranch.watchedAt = new Date().toISOString();
            }
            
            store.persist(); 
            alert("ПОБЕДИТЕЛЬ: " + (winner.title || winner.name));
            this.session = { pool: [], elim: [] }; 
            this.changeView('watched');
        } else { this.render(); }
    },

    deleteMovie(id) { if(confirm("Удалить фильм?")) { store.movies = store.movies.filter(m=>m.id!==id); store.persist(); this.render(); } },
    deleteFranchise(id) { if(confirm("Удалить франшизу?")) { store.franchises = store.franchises.filter(f=>f.id!==id); store.persist(); this.render(); } },
    deleteCategory(id) { if(confirm("Удалить категорию?")) { store.categories = store.categories.filter(c=>c.id!==id); store.persist(); this.render(); } },
    deletePlayer(name) { delete store.saves[name]; store.persist(); this.modalSaves(); }
};

UI.init();