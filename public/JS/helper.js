
// ── CONFIG ──
// Initialize token early so helper functions can reference it safely.
let me = null;
let token = localStorage.getItem('st');
const APP_PATH = window.location.pathname.replace(/\/[^/]*$/, '').replace(/\/$/, '');
const BASE = new URL((APP_PATH || '/') + '/', window.location.origin).href;
let allSingles = [], allAlbums = [];
let currentTrack = null, playing = false, timer = null, fp = 0, fd = 200;
let trackCount = 0;
let selectedRole = 'fan';
let composeMode = null; // 'text' | 'image'
let selectedImageFile = null;
let postPage = 1, postPages = 1;

// ── API ──
async function api(method, path, body, isForm) {
  const headers = { ...(token ? {'Authorization':'Bearer '+token} : {}), ...(!isForm && body ? {'Content-Type':'application/json'} : {}) };
  const fullPath = new URL(`api${path.replace(/^\//, '')}`, BASE).href;

  async function request(url) {
    console.log('API request', method, url);
    const res = await fetch(url, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch (error) { data = { error: text || 'Invalid response from server' }; }
    return { res, data, text };
  }

  let result = await request(fullPath);

  if (!result.res.ok) {
    const errMsg = result.data.error || `Error ${result.res.status}`;
    console.error('API error', { method, path, status: result.res.status, body: result.data, raw: result.text });
    throw new Error(errMsg);
  }
  return result.data;
}

// ── INIT ──
async function init() {
  if (token) {
    try { const d = await api('GET','/auth/me'); applyUser(d.user, token); }
    catch { token=null; localStorage.removeItem('st'); }
  }
  updateUI();
  await Promise.all([loadMusic(), loadSocialStats()]);
  await loadPosts(1);
}

// ── AUTH ──
function openAuth(t) { document.getElementById('auth-overlay').classList.add('open'); switchAuthTab(t); clearErr(); }
function closeAuth() { document.getElementById('auth-overlay').classList.remove('open'); }
function switchAuthTab(t) {
  document.getElementById('login-form').style.display = t==='login'?'block':'none';
  document.getElementById('reg-form').style.display = t==='register'?'block':'none';
  document.getElementById('atab-login').classList.toggle('active', t==='login');
  document.getElementById('atab-reg').classList.toggle('active', t==='register');
  document.getElementById('auth-sub-text').textContent = t==='login'?'Sign in to your account':'Create your SOLACE account';
  document.getElementById('auth-switch').innerHTML = t==='login'
    ? `Don't have an account? <span onclick="switchAuthTab('register')">Join now</span>`
    : `Already have an account? <span onclick="switchAuthTab('login')">Sign in</span>`;
  clearErr();
}
function setRole(r) {
  selectedRole = r;
  document.getElementById('rb-fan').classList.toggle('active', r==='fan');
  document.getElementById('rb-artist').classList.toggle('active', r==='artist');
}
function showErr(m) { const e=document.getElementById('auth-err'); e.textContent=m; e.classList.add('show'); }
function clearErr() { document.getElementById('auth-err').classList.remove('show'); }

async function doLogin() {
  clearErr();
  const email=document.getElementById('l-email').value.trim(), pass=document.getElementById('l-pass').value;
  if (!email||!pass) return showErr('Fill in all fields');
  try {
    const d=await api('POST','/auth/login',{email,password:pass});
    applyUser(d.user,d.token);
    closeAuth();
    updateUI();
    toast('Welcome back, '+d.user.username+'! 🎵');
  } catch(e) {
    console.error('Login failed', { email, message: e.message });
    showErr(e.message || 'Login failed. Check console for details.');
  }
}
async function doRegister() {
  clearErr();
  const username=document.getElementById('r-user').value.trim(), email=document.getElementById('r-email').value.trim(), pass=document.getElementById('r-pass').value;
  if (!username||!email||!pass) return showErr('Fill in all fields');
  if (pass.length<6) return showErr('Password must be at least 6 characters');
  try { const d=await api('POST','/auth/register',{username,email,password:pass,role:selectedRole}); applyUser(d.user,d.token); closeAuth(); updateUI(); toast('Welcome, '+d.user.username+'! 🎉'); }
  catch(e) { showErr(e.message); }
}
function applyUser(user, tok) {
  me=user; token=tok; localStorage.setItem('st',tok);
}
function logout() {
  me=null; token=null; localStorage.removeItem('st');
  updateUI(); toast('Signed out. See you soon!');
  loadPosts(1);
}
function updateUI() {
  const loggedIn = !!me;
  const headerGuest = document.getElementById('header-guest');
  const headerUser = document.getElementById('header-user');
  if (headerGuest) headerGuest.style.display = loggedIn ? 'none' : 'flex';
  if (headerUser) headerUser.style.display = loggedIn ? 'block' : 'none';

  if (me) {
    const avatarEl = document.getElementById('h-avatar');
    const nameEl = document.getElementById('h-name');
    const roleEl = document.getElementById('h-role');
    const composerAvatar = document.getElementById('composer-av');
    if (avatarEl) avatarEl.textContent = me.avatar||'🎧';
    if (nameEl) nameEl.textContent = me.username;
    if (roleEl) {
      roleEl.textContent = me.role;
      roleEl.className = 'u-role ' + (me.role==='artist'?'artist':'fan');
    }
    if (composerAvatar) composerAvatar.textContent = me.avatar||'🎧';
  }

  const isArtist = me && me.role==='artist';
  const uploadGate = document.getElementById('upload-gate');
  const uploadPanel = document.getElementById('upload-panel');
  const composer = document.getElementById('composer');
  const feedLoginPrompt = document.getElementById('feed-login-prompt');
  const sidebarLogin = document.getElementById('sidebar-login');

  if (uploadGate) uploadGate.style.display = isArtist ? 'none' : 'block';
  if (uploadPanel) uploadPanel.style.display = isArtist ? 'block' : 'none';
  if (composer) composer.style.display = loggedIn ? 'block' : 'none';
  if (feedLoginPrompt) feedLoginPrompt.style.display = loggedIn ? 'none' : 'block';
  if (sidebarLogin) sidebarLogin.style.display = loggedIn ? 'none' : 'block';

  renderSingles(allSingles); renderAlbums(allAlbums);
}

// ── MUSIC ──
async function loadMusic() {
  try {
    const [s,a] = await Promise.all([api('GET','/music?type=single'), api('GET','/music?type=album')]);
    allSingles=s.music; allAlbums=a.music;
    renderSingles(allSingles); renderAlbums(allAlbums);
    const statTracks = document.getElementById('stat-tracks');
    const statAlbums = document.getElementById('stat-albums');
    const statStreams = document.getElementById('stat-streams');
    if (statTracks) statTracks.textContent = allSingles.length + allAlbums.reduce((n,a)=>n+(a.track_count||0),0);
    if (statAlbums) statAlbums.textContent = allAlbums.length;
    if (statStreams) statStreams.textContent = allSingles.reduce((n,s)=>n+(s.stream_count||0),0);
  } catch {
    const singlesGrid = document.getElementById('singles-grid');
    if (singlesGrid) singlesGrid.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p class="empty-text">Could not load music. Is the server running?</p></div>';
  }
}
async function loadSocialStats() {
  try {
    const d=await api('GET','/social/stats');
    document.getElementById('stat-posts').textContent = d.total_posts;
    document.getElementById('ss-posts').textContent = d.total_posts;
    document.getElementById('ss-comments').textContent = d.total_comments;
    document.getElementById('ss-likes').textContent = d.total_likes;
    document.getElementById('ss-fans').textContent = d.active_fans;
  } catch {}
}

function renderSingles(list) {
  const g=document.getElementById('singles-grid');
  if (!g) return;
  if (!list||!list.length) { g.innerHTML='<div class="empty-state"><div class="empty-icon">🎵</div><p class="empty-text">No singles yet.</p></div>'; return; }
  g.innerHTML=list.map((s,i)=>`
    <div class="music-card" onclick="playSingle(${i})">
      <div class="card-art">${s.emoji||'🎵'}
        <div class="play-overlay"><div class="play-overlay-btn">▶</div></div>
        <span class="card-badge">Single</span>
        ${canDelete(s)?`<button class="delete-card-btn" onclick="event.stopPropagation();delMusic('${s.id}')">🗑</button>`:''}
      </div>
      <div class="card-body">
        <div class="card-title">${esc(s.title)}</div>
        <div class="card-meta"><span>${esc(s.genre||'Music')}</span><div class="card-dot"></div><span>${s.year||''}</span></div>
        <div class="card-actions"><span class="card-info">${s.stream_count||0} streams</span>
          ${s.allow_download?`<button class="dl-btn" onclick="event.stopPropagation();dlMusic('${s.id}','${esc(s.title)}')">↓</button>`:'<span class="card-info">Stream only</span>'}
        </div>
      </div>
    </div>`).join('');
}
function renderAlbums(list) {
  const g=document.getElementById('albums-grid');
  if (!g) return;
  if (!list||!list.length) { g.innerHTML='<div class="empty-state"><div class="empty-icon">💿</div><p class="empty-text">No albums yet.</p></div>'; return; }
  g.innerHTML=list.map((a,i)=>`
    <div class="music-card" onclick="openAlbum(${i})">
      <div class="card-art">${a.emoji||'💿'}
        <div class="play-overlay"><div class="play-overlay-btn">▶</div></div>
        <span class="card-badge">Album</span>
        ${canDelete(a)?`<button class="delete-card-btn" onclick="event.stopPropagation();delMusic('${a.id}')">🗑</button>`:''}
      </div>
      <div class="card-body">
        <div class="card-title">${esc(a.title)}</div>
        <div class="card-meta"><span>${esc(a.genre||'Music')}</span><div class="card-dot"></div><span>${a.year||''}</span></div>
        <div class="card-actions"><span class="card-info">${a.track_count||0} tracks</span>
          ${a.allow_download?`<button class="dl-btn" onclick="event.stopPropagation();dlMusic('${a.id}','${esc(a.title)}')">↓ Album</button>`:'<span class="card-info">Stream only</span>'}
        </div>
      </div>
    </div>`).join('');
}
function canDelete(item) { return me && me.role==='artist' && item.artist_id===me.id; }
function openAlbum(i) {
  const a=allAlbums[i];
  document.getElementById('m-art').textContent=a.emoji||'💿';
  document.getElementById('m-title').textContent=a.title;
  document.getElementById('m-meta').textContent=`${a.genre||''} · ${a.year||''} · ${a.tracks.length} tracks`;
  document.getElementById('m-tracks').innerHTML=a.tracks.map((t,ti)=>`
    <div class="track-item" id="mtr-${ti}" onclick="playAlbumTrack(${i},${ti})">
      <span class="t-num">${ti+1}</span>
      <div class="t-name">${esc(t.title)}</div>
      <span class="t-dur">${t.duration||'—'}</span>
      ${a.allow_download?`<button class="t-dl" onclick="event.stopPropagation();dlMusic('${a.id}','${esc(t.title)}')">↓</button>`:''}
    </div>`).join('');
  document.getElementById('album-overlay').classList.add('open');
}
function closeAlbum() { document.getElementById('album-overlay').classList.remove('open'); }

// ── PLAYER ──
function playSingle(i) { const s=allSingles[i]; if(!s||!s.tracks||!s.tracks.length) return; startPlay({title:s.title,emoji:s.emoji,id:s.tracks[0].id}); if(s.tracks[0].id) logStream(s.tracks[0].id); }
function playAlbumTrack(ai,ti) { const a=allAlbums[ai],t=a.tracks[ti]; startPlay({title:t.title,emoji:a.emoji,id:t.id}); document.querySelectorAll('.track-item').forEach(r=>r.classList.remove('playing')); const row=document.getElementById('mtr-'+ti); if(row) row.classList.add('playing'); if(t.id) logStream(t.id); }
function playFirst() { if(allSingles.length) playSingle(0); else if(allAlbums.length) playAlbumTrack(0,0); }
function startPlay(t) {
  currentTrack=t; playing=true;
  document.getElementById('p-name').textContent=t.title;
  document.getElementById('p-thumb').textContent=t.emoji||'🎵';
  document.getElementById('play-btn').textContent='⏸';
  document.getElementById('player').classList.add('visible');
  fp=0; fd=160+Math.floor(Math.random()*120);
  clearInterval(timer); timer=setInterval(tick,1000);
}
function togglePlay() { if(!currentTrack){playFirst();return;} playing=!playing; document.getElementById('play-btn').textContent=playing?'⏸':'▶'; if(playing) timer=setInterval(tick,1000); else clearInterval(timer); }
function tick() { if(!playing) return; fp++; if(fp>=fd){fp=0;nextTrack();return;} const pct=(fp/fd)*100; document.getElementById('p-fill').style.width=pct+'%'; document.getElementById('p-cur').textContent=fmt(fp); document.getElementById('p-dur').textContent=fmt(fd); }
function seekTo(e) { const p=e.offsetX/e.currentTarget.offsetWidth; fp=Math.floor(p*fd); document.getElementById('p-fill').style.width=(p*100)+'%'; document.getElementById('p-cur').textContent=fmt(fp); }
function prevTrack() { if(!allSingles.length) return; const i=Math.max(0,(allSingles.findIndex(s=>s.title===currentTrack?.title)||0)-1); playSingle(i); }
function nextTrack() { if(!allSingles.length) return; const i=Math.min(allSingles.length-1,(allSingles.findIndex(s=>s.title===currentTrack?.title)||0)+1); playSingle(i); }
function fmt(s) { return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
async function logStream(id) { try { await api('POST','/music/stream/'+id); } catch {} }

// ── DOWNLOAD / DELETE (music) ──
async function dlMusic(id, title) {
  if (!me) { toast('Sign in to download 🎵'); openAuth('login'); return; }
  try { await api('POST','/music/download/'+id); toast('↓ Downloading "'+title+'"…'); } catch(e) { toast(e.message,true); }
}
async function delMusic(id) {
  if (!confirm('Delete this? Cannot be undone.')) return;
  try { await api('DELETE','/music/'+id); await loadMusic(); toast('Deleted.'); } catch(e) { toast(e.message,true); }
}

// ── UPLOAD ──
function switchUpTab(t) {
  document.getElementById('form-single').style.display=t==='single'?'block':'none';
  document.getElementById('form-album').style.display=t==='album'?'block':'none';
  document.getElementById('tab-s').classList.toggle('active',t==='single');
  document.getElementById('tab-a').classList.toggle('active',t==='album');
  if(t==='album'&&!document.getElementById('track-rows').children.length){addTrackRow();addTrackRow();addTrackRow();}
}
function addTrackRow() {
  trackCount++;
  const d=document.createElement('div'); d.className='track-row-editor'; d.id='tr-'+trackCount;
  d.innerHTML=`<span class="track-num-ed">${trackCount}</span><input type="text" class="track-input" placeholder="Track ${trackCount} title…"/><button class="track-del-btn" onclick="this.closest('.track-row-editor').remove()">✕</button>`;
  document.getElementById('track-rows').appendChild(d);
}
function labelFile(id,inp) { if(inp.files[0]) document.getElementById(id).textContent='✓ '+inp.files[0].name; }
async function publishSingle() {
  const title=document.getElementById('s-title').value.trim(); if(!title) return toast('Enter a title',true);
  const btn=document.getElementById('s-submit'); btn.disabled=true; btn.textContent='Publishing…';
  try {
    const fd=new FormData();
    fd.append('type','single'); fd.append('title',title);
    fd.append('genre',document.getElementById('s-genre').value);
    fd.append('year',document.getElementById('s-year').value||new Date().getFullYear());
    fd.append('emoji',document.getElementById('s-emoji').value||'🎵');
    fd.append('description',document.getElementById('s-desc').value);
    fd.append('allow_download',document.getElementById('s-dl').checked?'true':'false');
    const file=document.getElementById('s-file').files[0]; if(file) fd.append('audio',file);
    const d=await api('POST','/music',fd,true);
    allSingles.unshift(d.music); renderSingles(allSingles);
    ['s-title','s-emoji','s-desc'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('s-drop-label').textContent='Drop audio file here';
    toast('🎵 "'+title+'" published!'); goto('music'); await loadSocialStats();
  } catch(e) { toast(e.message,true); }
  finally { btn.disabled=false; btn.textContent='Publish Single →'; }
}
async function publishAlbum() {
  const title=document.getElementById('a-title').value.trim(); if(!title) return toast('Enter album title',true);
  const inputs=document.querySelectorAll('#track-rows .track-input');
  if(!inputs.length) return toast('Add at least one track',true);
  const tracks=Array.from(inputs).map((inp,i)=>({title:inp.value.trim()||`Track ${i+1}`,duration:'3:00'}));
  const btn=document.getElementById('a-submit'); btn.disabled=true; btn.textContent='Publishing…';
  try {
    const fd=new FormData();
    fd.append('type','album'); fd.append('title',title);
    fd.append('genre',document.getElementById('a-genre').value);
    fd.append('year',document.getElementById('a-year').value||new Date().getFullYear());
    fd.append('emoji',document.getElementById('a-emoji').value||'💿');
    fd.append('description',document.getElementById('a-desc').value);
    fd.append('allow_download',document.getElementById('a-dl').checked?'true':'false');
    fd.append('tracks',JSON.stringify(tracks));
    const d=await api('POST','/music',fd,true);
    allAlbums.unshift(d.music); renderAlbums(allAlbums);
    ['a-title','a-emoji','a-desc'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('track-rows').innerHTML=''; trackCount=0;
    toast('💿 "'+title+'" published!'); goto('albums');
  } catch(e) { toast(e.message,true); }
  finally { btn.disabled=false; btn.textContent='Publish Album →'; }
}

// ── SOCIAL: COMPOSE ──
function openCompose(mode) {
  if (!me) { openAuth('login'); return; }
  composeMode=mode;
  document.getElementById('compose-panel').classList.add('open');
  document.getElementById('cb-text').classList.toggle('active',mode==='text');
  document.getElementById('cb-image').classList.toggle('active',mode==='image');
  document.getElementById('compose-text').focus();
  if (mode==='image' && !selectedImageFile) {
    document.getElementById('compose-img').click();
  }
}
function closeCompose() {
  document.getElementById('compose-panel').classList.remove('open');
  document.getElementById('compose-text').value='';
  document.getElementById('char-count').textContent='0 / 1000';
  removeImage(); composeMode=null;
  document.getElementById('cb-text').classList.remove('active');
  document.getElementById('cb-image').classList.remove('active');
  document.getElementById('post-btn').disabled=true;
}
function updateCharCount() {
  const len=document.getElementById('compose-text').value.length;
  const el=document.getElementById('char-count');
  el.textContent=len+' / 1000';
  el.className='char-count'+(len>900?' warn':'');
  checkPostReady();
}
function checkPostReady() {
  const hasText=document.getElementById('compose-text').value.trim().length>0;
  const hasImg=!!selectedImageFile;
  document.getElementById('post-btn').disabled=(!hasText&&!hasImg);
}
function previewImage(input) {
  const file=input.files[0]; if(!file) return;
  selectedImageFile=file;
  const reader=new FileReader();
  reader.onload=e=>{ document.getElementById('img-preview').src=e.target.result; document.getElementById('img-preview-wrap').classList.add('show'); };
  reader.readAsDataURL(file);
  composeMode='image';
  document.getElementById('compose-panel').classList.add('open');
  document.getElementById('cb-image').classList.add('active');
  document.getElementById('cb-text').classList.remove('active');
  checkPostReady();
}
function removeImage() {
  selectedImageFile=null;
  document.getElementById('img-preview').src='';
  document.getElementById('img-preview-wrap').classList.remove('show');
  document.getElementById('compose-img').value='';
  checkPostReady();
}
async function submitPost() {
  const text=document.getElementById('compose-text').value.trim();
  if(!text&&!selectedImageFile) return;
  const btn=document.getElementById('post-btn');
  btn.disabled=true; btn.textContent='Posting…';
  try {
    const fd=new FormData();
    if(text) fd.append('content',text);
    if(selectedImageFile) fd.append('image',selectedImageFile);
    const d=await api('POST','/social/posts',fd,true);
    closeCompose();
    prependPost(d.post);
    await loadSocialStats();
    toast('Post shared! 🎉');
  } catch(e) { toast(e.message,true); }
  finally { btn.textContent='Post'; checkPostReady(); }
}

// ── SOCIAL: FEED ──
async function loadPosts(page=1) {
  if (page===1) document.getElementById('posts-feed').innerHTML='<div class="loading-state"><div class="spinner"></div>Loading posts…</div>';
  try {
    const d=await api('GET','/social/posts?page='+page+'&limit=10');
    postPage=d.page; postPages=d.pages;
    if(page===1) document.getElementById('posts-feed').innerHTML='';
    d.posts.forEach(p=>appendPost(p));
    document.getElementById('load-more').style.display=postPage<postPages?'block':'none';
    if(page===1&&d.posts.length===0) document.getElementById('posts-feed').innerHTML='<div class="empty-state"><div class="empty-icon">📭</div><p class="empty-text">No posts yet. Be the first to share!</p></div>';
  } catch(e) { document.getElementById('posts-feed').innerHTML='<div class="empty-state"><div class="empty-icon">⚠️</div><p class="empty-text">Could not load posts.</p></div>'; }
}
async function loadMorePosts() {
  await loadPosts(postPage+1);
}

function prependPost(post) {
  const el=buildPostEl(post);
  const feed=document.getElementById('posts-feed');
  const empty=feed.querySelector('.empty-state');
  if(empty) feed.innerHTML='';
  feed.insertBefore(el,feed.firstChild);
}
function appendPost(post) {
  const el=buildPostEl(post);
  document.getElementById('posts-feed').appendChild(el);
}

function buildPostEl(post) {
  const isOwn=me&&me.id===post.user_id;
  const div=document.createElement('div');
  div.className='post-card'; div.id='post-'+post.id;
  div.innerHTML=`
    <div class="post-header">
      <div class="post-avatar">${esc(post.avatar||'🎧')}</div>
      <div class="post-meta">
        <div class="post-author">
          ${esc(post.username)}
          <span class="post-role-tag ${post.role==='artist'?'artist':''}">${post.role}</span>
        </div>
        <div class="post-time">${relTime(post.created_at)}</div>
      </div>
      ${isOwn?`<button class="post-delete" onclick="deletePost('${post.id}')" title="Delete">🗑</button>`:''}
    </div>
    ${post.content?`<div class="post-content">${escNl(post.content)}</div>`:''}
    ${post.image_url?`<img class="post-image" src="${esc(post.image_url)}" alt="Post image" loading="lazy"/>`:''}
    <div class="post-footer">
      <button class="post-action${post.liked_by_me?' liked':''}" id="like-btn-${post.id}" onclick="toggleLike('${post.id}')">
        <svg viewBox="0 0 24 24"><path d="${post.liked_by_me?'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z':'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z'}"/></svg>
        <span id="like-count-${post.id}">${post.like_count||0}</span>
      </button>
      <div class="divider-dot"></div>
      <button class="post-action" onclick="toggleComments('${post.id}')">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
        <span id="comm-count-${post.id}">${post.comment_count||0}</span>
      </button>
    </div>
    <div class="comments-section hidden" id="comments-${post.id}">
      <div id="comments-list-${post.id}"><div class="loading-state" style="padding:14px;font-size:.8rem"><div class="spinner" style="width:20px;height:20px;border-width:2px"></div></div></div>
      ${me?`<div class="comment-composer">
        <div class="comment-avatar">${esc(me.avatar||'🎧')}</div>
        <input type="text" class="comment-input" id="ci-${post.id}" placeholder="Write a comment…" onkeydown="if(event.key==='Enter')sendComment('${post.id}')"/>
        <button class="comment-send" onclick="sendComment('${post.id}')">↑</button>
      </div>`:'<p style="font-size:.78rem;color:var(--muted);margin-top:8px"><span style="color:var(--gold);cursor:pointer" onclick="openAuth(\'login\')">Sign in</span> to comment</p>'}
    </div>`;
  return div;
}

async function toggleLike(postId) {
  if (!me) { openAuth('login'); return; }
  try {
    const d=await api('POST','/social/posts/'+postId+'/like');
    const btn=document.getElementById('like-btn-'+postId);
    const count=document.getElementById('like-count-'+postId);
    btn.className='post-action'+(d.liked?' liked':'');
    btn.querySelector('path').setAttribute('d', d.liked
      ? 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
      : 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z');
    count.textContent=d.like_count;
  } catch(e) { toast(e.message,true); }
}

async function toggleComments(postId) {
  const section=document.getElementById('comments-'+postId);
  const hidden=section.classList.contains('hidden');
  section.classList.toggle('hidden');
  if (hidden) await loadComments(postId);
}

async function loadComments(postId) {
  try {
    const d=await api('GET','/social/posts/'+postId+'/comments');
    const list=document.getElementById('comments-list-'+postId);
    if(!d.comments.length) { list.innerHTML='<p style="font-size:.78rem;color:var(--muted);margin-bottom:8px">No comments yet. Be first!</p>'; return; }
    list.innerHTML=d.comments.map(c=>`
      <div class="comment-item" id="cmt-${c.id}">
        <div class="comment-avatar">${esc(c.avatar||'🎧')}</div>
        <div class="comment-body">
          <div class="comment-author">
            ${esc(c.username)}
            <span class="post-role-tag ${c.role==='artist'?'artist':''}" style="font-size:.55rem">${c.role}</span>
            ${me&&me.id===c.user_id?`<button class="comment-del" onclick="deleteComment('${c.id}','${postId}')">✕</button>`:''}
          </div>
          <div class="comment-text">${escNl(c.content)}</div>
        </div>
      </div>`).join('');
  } catch(e) { document.getElementById('comments-list-'+postId).innerHTML='<p style="font-size:.78rem;color:var(--danger)">Could not load comments.</p>'; }
}

async function sendComment(postId) {
  if(!me) { openAuth('login'); return; }
  const inp=document.getElementById('ci-'+postId);
  const content=inp.value.trim(); if(!content) return;
  try {
    const d=await api('POST','/social/posts/'+postId+'/comments',{content});
    inp.value='';
    const list=document.getElementById('comments-list-'+postId);
    const empty=list.querySelector('p');
    if(empty) list.innerHTML='';
    const el=document.createElement('div');
    el.className='comment-item'; el.id='cmt-'+d.comment.id;
    el.innerHTML=`
      <div class="comment-avatar">${esc(d.comment.avatar||'🎧')}</div>
      <div class="comment-body">
        <div class="comment-author">${esc(d.comment.username)} <span class="post-role-tag ${d.comment.role==='artist'?'artist':''}"> ${d.comment.role}</span>
          <button class="comment-del" onclick="deleteComment('${d.comment.id}','${postId}')">✕</button>
        </div>
        <div class="comment-text">${escNl(d.comment.content)}</div>
      </div>`;
    list.appendChild(el);
    const cnt=document.getElementById('comm-count-'+postId);
    if(cnt) cnt.textContent=parseInt(cnt.textContent||0)+1;
    await loadSocialStats();
  } catch(e) { toast(e.message,true); }
}

async function deletePost(id) {
  if(!confirm('Delete this post?')) return;
  try {
    await api('DELETE','/social/posts/'+id);
    const el=document.getElementById('post-'+id);
    if(el) el.remove();
    await loadSocialStats();
    toast('Post deleted.');
  } catch(e) { toast(e.message,true); }
}

async function deleteComment(id, postId) {
  try {
    await api('DELETE','/social/comments/'+id);
    const el=document.getElementById('cmt-'+id);
    if(el) el.remove();
    const cnt=document.getElementById('comm-count-'+postId);
    if(cnt) cnt.textContent=Math.max(0,parseInt(cnt.textContent||0)-1);
    await loadSocialStats();
  } catch(e) { toast(e.message,true); }
}

// ── UTILS ──
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escNl(s) { return esc(s).replace(/\n/g,'<br>'); }
function goto(id) { document.getElementById(id)?.scrollIntoView({behavior:'smooth'}); }
function relTime(ts) {
  const diff=(Date.now()-new Date(ts))/1000;
  if(diff<60) return 'just now';
  if(diff<3600) return Math.floor(diff/60)+'m ago';
  if(diff<86400) return Math.floor(diff/3600)+'h ago';
  return Math.floor(diff/86400)+'d ago';
}
function toast(msg, isErr=false) {
  const el=document.getElementById('toast');
  el.textContent=msg; el.className='toast show'+(isErr?' err':'');
  setTimeout(()=>el.classList.remove('show'),3200);
}

// ── MOBILE NAV TOGGLE ──
function toggleMobileNav() {
  const nav = document.querySelector('.nav-links');
  if (!nav) return;
  nav.classList.toggle('mobile-open');
}

// Close mobile nav when resizing to desktop
window.addEventListener('resize', ()=>{
  const nav = document.querySelector('.nav-links');
  if (!nav) return;
  if (window.innerWidth > 768 && nav.classList.contains('mobile-open')) nav.classList.remove('mobile-open');
});

// ── KEYBOARD SHORTCUTS ──
// document.getElementById('l-pass').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
// document.getElementById('r-pass').addEventListener('keydown',e=>{ if(e.key==='Enter') doRegister(); });

// ── DRAG DROP (audio) ──
// const dz=document.getElementById('s-drop');
// ['dragover','dragenter'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag-over');}));
// ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag-over');}));
// dz.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f) document.getElementById('s-drop-label').textContent='✓ '+f.name;});

init();
