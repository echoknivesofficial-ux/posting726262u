<script>
  (function () {
    'use strict';

    // ─────────────────────────────────────────────
    // 🔧 CONFIG
    // ─────────────────────────────────────────────
    const API_BASE = 'https://posting726262u.onrender.com';
    const GROQ_API_KEY = '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';
    const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
    const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

    const state = {
      items: [], meta: null, cart: [],
      activeHub: 'all', activeCategory: 'all',
      search: '', batch: 'all', price: 'all',
      adminPasscode: null,
      uploadedImageUrl: null
    };

    const $ = (id) => document.getElementById(id);
    const productGrid = $('productGrid');
    const emptyState = $('emptyState');
    const errorState = $('errorState');
    const errorDetail = $('errorDetail');
    const loadingState = $('loadingState');
    const resultCount = $('resultCount');
    const statItems = $('statItems');
    const cartCount = $('cartCount');
    const mobileCartCount = $('mobileCartCount');
    const cartDrawer = $('cartDrawer');
    const cartPanel = $('cartPanel');
    const cartItems = $('cartItems');
    const cartSubtotal = $('cartSubtotal');
    const cartTotal = $('cartTotal');
    const deliveryFeeEl = $('deliveryFee');
    const quickViewModal = $('quickViewModal');
    const quickViewPanel = $('quickViewPanel');
    const quickViewContent = $('quickViewContent');
    const checkoutModal = $('checkoutModal');
    const checkoutPanel = $('checkoutPanel');
    const staffLoginModal = $('staffLoginModal');
    const staffLoginPanel = $('staffLoginPanel');
    const adminDrawer = $('adminDrawer');
    const adminPanel = $('adminPanel');
    const adminList = $('adminList');
    const legalModal = $('legalModal');
    const legalPanel = $('legalPanel');
    const legalTitle = $('legalTitle');
    const legalContent = $('legalContent');
    const toastBox = $('toastContainer');

    const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH');
    const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

    function showToast(msg, type = 'success') {
      const el = document.createElement('div');
      el.className = `toast-animate pointer-events-auto px-4 py-3 rounded-2xl shadow-xl text-[11px] font-medium flex items-center gap-2 border ${
        type === 'success' ? 'bg-[#18181B] border-white text-white' : 'bg-[#18181B] border-red-500 text-red-400'
      }`;
      el.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i> ${msg}`;
      toastBox.appendChild(el);
      setTimeout(() => {
        el.style.opacity = '0'; el.style.transform = 'translateY(10px)'; el.style.transition = 'all .3s';
        setTimeout(() => el.remove(), 300);
      }, 2800);
    }
    window.showToast = showToast;

    async function api(path, opts = {}) {
      const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      if (state.adminPasscode) headers['X-Admin-Passcode'] = state.adminPasscode;
      const res = await fetch(API_BASE + path, { ...opts, headers });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!res.ok) {
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.status = res.status; err.data = data;
        throw err;
      }
      return data;
    }

    function openModal(overlay, panel) {
      overlay.classList.remove('hidden'); overlay.classList.add('flex');
      setTimeout(() => panel.classList.add('modal-enter-active'), 10);
    }
    function closeModal(overlay, panel) {
      panel.classList.remove('modal-enter-active');
      setTimeout(() => { overlay.classList.add('hidden'); overlay.classList.remove('flex'); }, 200);
    }

    function escapeHtml(s = '') {
      return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    // =================================================
    // BOOT
    // =================================================
    async function boot() {
      try {
        loadingState.classList.remove('hidden');
        productGrid.classList.add('hidden');

        const [meta, items] = await Promise.all([api('/api/meta'), api('/api/items')]);
        state.meta = meta;
        state.items = items;

        populateDeliveryAndPaymentSelects();
        populateCitySelects();

        loadingState.classList.add('hidden');
        productGrid.classList.remove('hidden');
        render();
        errorState.classList.add('hidden');
      } catch (err) {
        console.error('[SW627] boot failed:', err);
        loadingState.classList.add('hidden');
        errorState.classList.remove('hidden');
        errorDetail.textContent = `${API_BASE}/api/*  →  ${err.message}`;
      }
    }

    // =================================================
    // RENDER
    // =================================================
    function filtered() {
      return state.items.filter(i => {
        if (state.activeHub === 'manila' && i.hub !== 'Manila Hub') return false;
        if (state.activeHub === 'qc' && i.hub !== 'Quezon City Hub') return false;
        if (state.activeCategory !== 'all' && i.category !== state.activeCategory) return false;
        if (state.batch !== 'all' && i.batch !== state.batch) return false;
        if (state.search) {
          const q = state.search.toLowerCase();
          if (!i.title.toLowerCase().includes(q) && !i.batch.toLowerCase().includes(q)) return false;
        }
        if (state.price !== 'all') {
          const p = i.price;
          if (state.price === '0-2500' && p > 2500) return false;
          if (state.price === '2500-5000' && (p < 2500 || p > 5000)) return false;
          if (state.price === '5000-10000' && (p < 5000 || p > 10000)) return false;
          if (state.price === '10000+' && p < 10000) return false;
        }
        return true;
      });
    }

    function render() {
      const list = filtered();
      statItems.textContent = state.items.length;
      resultCount.textContent = list.length + ' drop' + (list.length === 1 ? '' : 's');

      if (!list.length) {
        productGrid.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
      }
      emptyState.classList.add('hidden');

      productGrid.innerHTML = list.map(item => `
        <div class="card rounded-2xl overflow-hidden cursor-pointer group" data-id="${item.id}">
          <div class="relative overflow-hidden aspect-square bg-[#27272A]">
            <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" class="card-img w-full h-full object-cover" loading="lazy" onerror="this.src='https://placehold.co/400x400/18181B/3F3F46?text=No+Image'">
            <span class="absolute top-2 left-2 bg-black/70 backdrop-blur-sm text-white text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border border-[#2E2E32]">${escapeHtml(item.batch)}</span>
            <span class="absolute top-2 right-2 bg-white text-black text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">${item.hub === 'Manila Hub' ? 'MANILA' : 'QC'}</span>
            ${item.status === 'Sold Out' ? '<div class="absolute inset-0 bg-black/60 flex items-center justify-center"><span class="text-white text-xs font-bold border border-white px-3 py-1 rounded">SOLD OUT</span></div>' : ''}
          </div>
          <div class="p-3">
            <h4 class="font-semibold text-[11px] md:text-xs leading-tight mb-1 line-clamp-1 text-white">${escapeHtml(item.title)}</h4>
            <p class="text-white font-bold text-sm font-mono">${peso(item.price)}</p>
            <div class="flex items-center gap-1 mt-1.5 flex-wrap">
              ${(item.sizes || []).slice(0, 3).map(s => `<span class="text-[8px] bg-[#27272A] text-zinc-400 px-1.5 py-0.5 rounded font-mono">${escapeHtml(s)}</span>`).join('')}
              ${(item.sizes || []).length > 3 ? `<span class="text-[8px] text-zinc-600 font-mono">+${item.sizes.length - 3}</span>` : ''}
            </div>
          </div>
        </div>
      `).join('');

      productGrid.querySelectorAll('[data-id]').forEach(card => {
        card.addEventListener('click', () => {
          const it = state.items.find(i => i.id === card.dataset.id);
          if (it) openQuickView(it);
        });
      });
    }

    // =================================================
    // QUICK VIEW
    // =================================================
    function openQuickView(item) {
      quickViewContent.innerHTML = `
        <div class="relative rounded-2xl overflow-hidden mb-4 border border-[#2E2E32]">
          <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" class="w-full aspect-square object-cover" onerror="this.src='https://placehold.co/400x400/18181B/3F3F46?text=No+Image'">
          <span class="absolute top-3 left-3 bg-black/70 backdrop-blur-sm text-white text-[9px] font-bold px-2 py-1 rounded uppercase tracking-wider border border-[#2E2E32]">${escapeHtml(item.batch)}</span>
          <span class="absolute top-3 right-3 bg-white text-black text-[9px] font-bold px-2 py-1 rounded uppercase tracking-wider">${item.hub === 'Manila Hub' ? 'MANILA' : 'QC'}</span>
        </div>
        <div class="flex items-start justify-between mb-2">
          <h2 class="font-display font-bold text-lg leading-tight flex-1">${escapeHtml(item.title)}</h2>
          <span class="text-white font-bold text-lg font-mono ml-3">${peso(item.price)}</span>
        </div>
        <div class="flex flex-wrap gap-1.5 mb-3">
          ${(item.sizes || []).map(s => `<span class="text-[10px] bg-[#18181B] border border-[#2E2E32] text-zinc-300 px-2 py-0.5 rounded font-mono">${escapeHtml(s)}</span>`).join('')}
        </div>
        <div class="bg-[#18181B] border border-[#2E2E32] rounded-xl p-3 mb-3">
          <p class="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-semibold">QC Notes</p>
          <p class="text-[11px] text-zinc-400 leading-relaxed">${escapeHtml(item.notes || 'No QC notes provided.')}</p>
        </div>
        <div class="text-[10px] text-zinc-600 mb-3 flex items-center gap-1.5">
          <i class="fas fa-truck text-zinc-500"></i> Same-day Lalamove / GrabExpress · Manila & QC only
        </div>
        ${item.status === 'Sold Out'
          ? '<button disabled class="w-full bg-[#27272A] text-zinc-500 font-semibold py-3 rounded-2xl text-xs cursor-not-allowed">Sold Out</button>'
          : `<button id="addBtn" class="w-full bg-white text-black font-semibold py-3 rounded-2xl text-xs btn-press hover:bg-zinc-200"><i class="fas fa-shopping-bag mr-1.5"></i> Add to Bag · ${peso(item.price)}</button>`
        }
      `;
      openModal(quickViewModal, quickViewPanel);
      $('addBtn')?.addEventListener('click', () => { addToCart(item); closeModal(quickViewModal, quickViewPanel); });
    }

    // =================================================
    // CART
    // =================================================
    function addToCart(item) {
      if (item.status === 'Sold Out') return showToast('This item is sold out.', 'error');
      if (state.cart.find(c => c.id === item.id)) return showToast('Item already in your bag', 'error');
      state.cart.push({ id: item.id, title: item.title, price: item.price, batch: item.batch, image: item.image, qty: 1 });
      updateCartUI();
      showToast(`Added "${item.title}" to your bag!`);
    }

    function updateCartUI() {
      const count = state.cart.reduce((n, i) => n + i.qty, 0);
      cartCount.textContent = count;
      mobileCartCount.textContent = count;

      if (!state.cart.length) {
        cartItems.innerHTML = '<p class="text-xs text-zinc-600 text-center py-8">Your bag is empty.</p>';
        cartSubtotal.textContent = peso(0);
        cartTotal.textContent = peso(80);
        deliveryFeeEl.textContent = peso(80);
        return;
      }
      let subtotal = 0;
      cartItems.innerHTML = state.cart.map(it => {
        subtotal += it.price * it.qty;
        return `
          <div class="flex gap-3 items-center bg-[#18181B] border border-[#2E2E32] rounded-xl p-2">
            <img src="${escapeHtml(it.image)}" class="w-12 h-12 rounded-lg object-cover border border-[#2E2E32]" onerror="this.src='https://placehold.co/80x80/18181B/3F3F46?text=?'">
            <div class="flex-1 min-w-0">
              <p class="text-[11px] font-semibold truncate">${escapeHtml(it.title)}</p>
              <p class="text-[10px] text-zinc-500 font-mono">${escapeHtml(it.batch)}</p>
              <p class="text-white text-[11px] font-bold font-mono">${peso(it.price)}</p>
            </div>
            <button class="remove-item text-zinc-500 hover:text-white p-1" data-id="${it.id}"><i class="fas fa-trash-alt text-[10px]"></i></button>
          </div>
        `;
      }).join('');
      cartSubtotal.textContent = peso(subtotal);
      cartTotal.textContent = peso(subtotal + 80);
      deliveryFeeEl.textContent = peso(80);

      cartItems.querySelectorAll('.remove-item').forEach(b => {
        b.addEventListener('click', () => {
          state.cart = state.cart.filter(c => c.id !== b.dataset.id);
          updateCartUI();
          showToast('Item removed.');
        });
      });
    }

    function openCart() {
      cartDrawer.classList.remove('hidden');
      setTimeout(() => { cartPanel.classList.remove('translate-x-full'); cartPanel.classList.add('translate-x-0'); }, 10);
    }
    function closeCart() {
      cartPanel.classList.remove('translate-x-0'); cartPanel.classList.add('translate-x-full');
      setTimeout(() => cartDrawer.classList.add('hidden'), 300);
    }

    // =================================================
    // CHECKOUT
    // =================================================
    function populateCitySelects() {
      const citySel = $('cCity');
      citySel.innerHTML = '<option value="">Select city</option>' +
        state.meta.cities.map(c => `<option value="${c}">${c === 'Manila' ? 'City of Manila' : 'Quezon City'}</option>`).join('');

      citySel.addEventListener('change', () => {
        const city = citySel.value;
        const districtSel = $('cDistrict');
        if (!city) {
          districtSel.disabled = true;
          districtSel.innerHTML = '<option value="">Select city first</option>';
          return;
        }
        const dists = state.meta.districts[city] || [];
        districtSel.disabled = false;
        districtSel.innerHTML = '<option value="">Select district</option>' +
          dists.map(d => `<option value="${d}">${d}</option>`).join('');
        refreshCheckoutTotals();
      });
    }

    function populateDeliveryAndPaymentSelects() {
      const delSel = $('cDelivery');
      delSel.innerHTML = '<option value="">Select delivery method</option>' +
        state.meta.deliveryMethods.map(m => `<option value="${m}">${m === 'Lalamove' || m === 'GrabExpress' ? m + ' (Same-day Rider)' : m}</option>`).join('');

      const meetSel = $('cMeetup');
      delSel.addEventListener('change', () => {
        if (delSel.value === 'Meetup') {
          const city = $('cCity').value;
          const spots = city ? state.meta.meetupSpots[city] || [] : [];
          meetSel.innerHTML = '<option value="">Select meetup spot</option>' +
            spots.map(s => `<option value="${s}">${s}</option>`).join('');
          meetSel.classList.remove('hidden');
        } else {
          meetSel.classList.add('hidden');
          meetSel.innerHTML = '';
        }
        refreshCheckoutTotals();
      });

      const paySel = $('cPayment');
      paySel.innerHTML = '<option value="">Select payment</option>' +
        state.meta.paymentMethods.map(m => `<option value="${m}">${m}</option>`).join('');

      paySel.addEventListener('change', () => {
        const isCash = paySel.value === 'Cash on Meetup';
        $('cPaymentRef').required = !isCash;
        $('cPaymentRef').placeholder = isCash ? 'Not required for Cash on Meetup' : 'Reference # (GCash/Maya/InstaPay)';
      });
    }

    function refreshCheckoutTotals() {
      const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
      const isMeetup = $('cDelivery').value === 'Meetup';
      const fee = isMeetup ? 0 : 80;
      $('coSubtotal').textContent = peso(subtotal);
      $('coDelivery').textContent = peso(fee);
      $('coTotal').textContent = peso(subtotal + fee);
    }

    function openCheckout() {
      if (!state.cart.length) return showToast('Your bag is empty.', 'error');
      refreshCheckoutTotals();
      openModal(checkoutModal, checkoutPanel);
    }
    function closeCheckout() { closeModal(checkoutModal, checkoutPanel); }

    async function submitOrder(e) {
      e.preventDefault();
      const errBox = $('checkoutError');
      errBox.classList.add('hidden');

      const payload = {
        items: state.cart.map(c => ({ id: c.id, qty: c.qty })),
        customer: {
          name: $('cName').value.trim(),
          phone: $('cPhone').value.trim(),
          city: $('cCity').value,
          district: $('cDistrict').value,
          address: $('cAddress').value.trim()
        },
        delivery: {
          method: $('cDelivery').value,
          meetupSpot: $('cMeetup').value || undefined,
          riderNote: $('cRiderNote').value.trim() || undefined
        },
        payment: {
          method: $('cPayment').value,
          reference: $('cPaymentRef').value.trim() || undefined
        },
        agreeToTerms: $('cAgree').checked
      };

      try {
        $('submitOrderBtn').disabled = true;
        $('submitOrderBtn').innerHTML = '<i class="fas fa-spinner spinner mr-2"></i> Placing order…';

        const order = await api('/api/orders', { method: 'POST', body: JSON.stringify(payload) });

        state.cart = [];
        updateCartUI();
        closeCheckout();
        closeCart();

        $('checkoutForm').reset();
        $('cDistrict').disabled = true;
        $('cDistrict').innerHTML = '<option value="">Select city first</option>';
        $('cMeetup').classList.add('hidden');

        showToast(`Order ${order.id} placed! We'll DM you for QC.`, 'success');
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
        showToast('Order failed: ' + err.message, 'error');
      } finally {
        $('submitOrderBtn').disabled = false;
        $('submitOrderBtn').textContent = 'Place Order';
      }
    }

    // =================================================
    // STAFF / ADMIN
    // =================================================
    function openStaffLogin() {
      if (state.adminPasscode) return openAdmin();
      $('staffPasscode').value = '';
      openModal(staffLoginModal, staffLoginPanel);
      setTimeout(() => $('staffPasscode').focus(), 100);
    }
    function closeStaffLogin() { closeModal(staffLoginModal, staffLoginPanel); }

    async function doStaffLogin() {
      const pass = $('staffPasscode').value;
      try {
        await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ passcode: pass }) });
        state.adminPasscode = pass;
        closeStaffLogin();
        setTimeout(openAdmin, 250);
        showToast('Authenticated. Welcome, Admin.');
      } catch { showToast('Invalid passcode.', 'error'); }
    }

    async function openAdmin() {
      adminDrawer.classList.remove('hidden');
      setTimeout(() => { adminPanel.classList.remove('translate-x-full'); adminPanel.classList.add('translate-x-0'); }, 10);
      await renderAdminList();
    }
    function closeAdmin() {
      adminPanel.classList.remove('translate-x-0'); adminPanel.classList.add('translate-x-full');
      setTimeout(() => adminDrawer.classList.add('hidden'), 300);
    }

    async function renderAdminList() {
      try {
        const items = await api('/api/items');
        adminList.innerHTML = items.map(i => `
          <div class="bg-[#18181B] border border-[#2E2E32] rounded-xl p-3 flex items-center gap-3">
            <img src="${escapeHtml(i.image)}" class="w-10 h-10 rounded-lg object-cover border border-[#2E2E32]" onerror="this.src='https://placehold.co/80x80/18181B/3F3F46?text=?'">
            <div class="flex-1 min-w-0">
              <p class="text-[11px] font-semibold truncate">${escapeHtml(i.title)}</p>
              <p class="text-[9px] text-zinc-500 font-mono">${escapeHtml(i.batch)} · ${peso(i.price)}</p>
            </div>
            <div class="flex items-center gap-1">
              <button class="toggle-status text-[9px] font-bold px-2 py-1 rounded border transition-colors ${
                i.status === 'In Stock' ? 'border-white text-white bg-white/10' : 'border-zinc-600 text-zinc-500'
              }" data-id="${i.id}" data-status="${i.status}">${i.status === 'In Stock' ? 'LIVE' : 'SOLD'}</button>
              <button class="delete-item text-zinc-500 hover:text-red-400 p-1" data-id="${i.id}"><i class="fas fa-trash-alt text-[10px]"></i></button>
            </div>
          </div>
        `).join('') || '<p class="text-[11px] text-zinc-600">No items yet.</p>';

        adminList.querySelectorAll('.toggle-status').forEach(b => {
          b.addEventListener('click', async () => {
            const newStatus = b.dataset.status === 'In Stock' ? 'Sold Out' : 'In Stock';
            try {
              await api('/api/admin/items/' + b.dataset.id, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
              showToast(`Marked as ${newStatus}.`);
              await refreshItems();
              await renderAdminList();
            } catch (err) { showToast(err.message, 'error'); }
          });
        });

        adminList.querySelectorAll('.delete-item').forEach(b => {
          b.addEventListener('click', async () => {
            if (!confirm('Delete this item permanently?')) return;
            try {
              await api('/api/admin/items/' + b.dataset.id, { method: 'DELETE' });
              showToast('Item deleted.', 'error');
              await refreshItems();
              await renderAdminList();
            } catch (err) { showToast(err.message, 'error'); }
          });
        });
      } catch (err) {
        if (err.status === 401) {
          state.adminPasscode = null;
          showToast('Session expired. Log in again.', 'error');
          closeAdmin();
          openStaffLogin();
        } else { showToast(err.message, 'error'); }
      }
    }

    async function refreshItems() {
      try { state.items = await api('/api/items'); render(); }
      catch (err) { showToast(err.message, 'error'); }
    }

    // =================================================
    // IMAGE UPLOAD
    // =================================================
    const dropZone = $('dropZone');
    const fileInput = $('aImageFile');
    const previewImg = $('aImagePreview');
    const dropInner = $('dropZoneInner');
    const uploadStatus = $('uploadStatus');

    dropZone.addEventListener('click', (e) => { if (e.target !== previewImg) fileInput.click(); });
    ['dragover','dragenter'].forEach(ev => dropZone.addEventListener(ev, (e) => {
      e.preventDefault(); dropZone.classList.add('border-white/60','bg-[#18181B]');
    }));
    ['dragleave','drop'].forEach(ev => dropZone.addEventListener(ev, (e) => {
      e.preventDefault(); dropZone.classList.remove('border-white/60','bg-[#18181B]');
    }));
    dropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0]; if (file) handleImageFile(file);
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]; if (file) handleImageFile(file);
    });

    async function handleImageFile(file) {
      if (!file.type.startsWith('image/')) {
        uploadStatus.textContent = '❌ Not an image file.';
        uploadStatus.className = 'text-[10px] mt-1.5 font-mono text-red-400';
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        uploadStatus.textContent = '❌ File too large (max 8MB).';
        uploadStatus.className = 'text-[10px] mt-1.5 font-mono text-red-400';
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        previewImg.src = ev.target.result;
        previewImg.classList.remove('hidden');
        dropInner.classList.add('hidden');
      };
      reader.readAsDataURL(file);

      uploadStatus.textContent = '⏳ Uploading…';
      uploadStatus.className = 'text-[10px] mt-1.5 font-mono text-zinc-400';

      try {
        const form = new FormData();
        form.append('image', file);

        const res = await fetch(API_BASE + '/api/admin/upload', {
          method: 'POST',
          headers: { 'X-Admin-Passcode': state.adminPasscode },
          body: form
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');

        state.uploadedImageUrl = data.url || (API_BASE + data.path);
        $('aImageUrl').value = '';
        uploadStatus.textContent = `✅ Uploaded · ${(data.size/1024).toFixed(0)} KB`;
        uploadStatus.className = 'text-[10px] mt-1.5 font-mono text-emerald-400';
        previewImg.src = state.uploadedImageUrl;
      } catch (err) {
        uploadStatus.textContent = '❌ ' + err.message;
        uploadStatus.className = 'text-[10px] mt-1.5 font-mono text-red-400';
        state.uploadedImageUrl = null;
      }
    }

    $('aImageUrl').addEventListener('input', (e) => {
      const url = e.target.value.trim();
      if (url) {
        state.uploadedImageUrl = null;
        previewImg.src = url;
        previewImg.classList.remove('hidden');
        dropInner.classList.add('hidden');
        uploadStatus.textContent = '🔗 Using URL';
        uploadStatus.className = 'text-[10px] mt-1.5 font-mono text-zinc-400';
      } else {
        previewImg.classList.add('hidden');
        dropInner.classList.remove('hidden');
        uploadStatus.textContent = '';
      }
    });

    async function submitAdminItem(e) {
      e.preventDefault();

      const imageValue = state.uploadedImageUrl || $('aImageUrl').value.trim();
      if (!imageValue) {
        showToast('Please upload an image or paste a URL.', 'error');
        return;
      }

      const body = {
        title: $('aTitle').value.trim(),
        price: Number($('aPrice').value),
        batch: $('aBatch').value,
        category: $('aCategory').value,
        hub: $('aHub').value,
        sizes: $('aSizes').value.split(',').map(s => s.trim()).filter(Boolean),
        image: imageValue,
        notes: $('aNotes').value.trim()
      };

      try {
        $('aSubmitBtn').disabled = true;
        $('aSubmitBtn').innerHTML = '<i class="fas fa-spinner spinner mr-1"></i> Publishing…';

        await api('/api/admin/items', { method: 'POST', body: JSON.stringify(body) });
        showToast(`"${body.title}" published!`);

        $('adminAddForm').reset();
        state.uploadedImageUrl = null;
        previewImg.classList.add('hidden');
        previewImg.src = '';
        dropInner.classList.remove('hidden');
        uploadStatus.textContent = '';

        await refreshItems();
        await renderAdminList();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        $('aSubmitBtn').disabled = false;
        $('aSubmitBtn').innerHTML = '<i class="fas fa-plus mr-1"></i> Publish';
      }
    }

    // =================================================
    // SCAN — Camera + Groq (Llama 4 Scout vision)
    // =================================================
    const scanModal = $('scanModal');
    const scanPanel = $('scanPanel');
    const cameraZone = $('cameraZone');
    const cameraInput = $('cameraInput');
    const scanPreview = $('scanPreview');
    const scanStep1 = $('scanStep1');
    const scanStep2 = $('scanStep2');
    const scanStep3 = $('scanStep3');
    const scanError = $('scanError');
    const scanStatus = $('scanStatus');
    const scanSubStatus = $('scanSubStatus');
    const resName = $('resName');
    const resMaterial = $('resMaterial');
    const resValue = $('resValue');
    const resValueNote = $('resValueNote');

    function openScan() {
      scanStep1.classList.remove('hidden');
      scanStep2.classList.add('hidden');
      scanStep3.classList.add('hidden');
      scanError.classList.add('hidden');
      scanPreview.classList.add('hidden');
      scanPreview.src = '';
      cameraInput.value = '';
      openModal(scanModal, scanPanel);
    }
    function closeScan() { closeModal(scanModal, scanPanel); }

    cameraZone.addEventListener('click', () => cameraInput.click());

    cameraInput.addEventListener('change', async () => {
      const file = cameraInput.files?.[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) return showToast('Please select an image.', 'error');
      if (file.size > 10 * 1024 * 1024) return showToast('Image too large (max 10MB).', 'error');

      const reader = new FileReader();
      reader.onload = (e) => {
        scanPreview.src = e.target.result;
        scanPreview.classList.remove('hidden');
      };
      reader.readAsDataURL(file);

      scanStep1.classList.add('hidden');
      scanStep2.classList.remove('hidden');
      scanError.classList.add('hidden');
      scanStatus.textContent = 'Analyzing item…';
      scanSubStatus.textContent = 'Groq · Llama 4 Scout · 2–5 seconds';

      try {
        const base64 = await fileToBase64(file);

        const response = await fetch(GROQ_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Analyze this clothing/fashion item photo. Return ONLY a JSON object with these exact keys, no markdown, no explanation:
{
  "item": "specific product name (e.g., 'Carhartt Detroit Jacket', 'Nike Air Force 1')",
  "material": "primary material composition (e.g., 'cotton canvas', 'full-grain leather')",
  "category": "one of: Sneakers, Apparel, Accessories",
  "estimatedValue": "approximate resale price in PHP (e.g., '₱1,200 – ₱1,800')",
  "condition": "visible condition assessment (e.g., 'Good', 'Like New', 'Worn')"
}`
                  },
                  {
                    type: 'image_url',
                    image_url: { url: `data:${file.type};base64,${base64}` }
                  }
                ]
              }
            ],
            temperature: 0.2,
            max_tokens: 300
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Groq ${response.status}: ${errText.slice(0, 160)}`);
        }

        const data = await response.json();
        const rawText = data?.choices?.[0]?.message?.content || '';
        if (!rawText) throw new Error('Empty response from Groq');

        let result;
        try {
          const match = rawText.match(/\{[\s\S]*\}/);
          result = match ? JSON.parse(match[0]) : { item: rawText, material: 'Unknown', category: '—', estimatedValue: '—', condition: '—' };
        } catch {
          result = { item: rawText, material: 'Unknown', category: '—', estimatedValue: '—', condition: '—' };
        }

        scanStep2.classList.add('hidden');
        scanStep3.classList.remove('hidden');
        resName.textContent = result.item || 'Unknown item';
        resMaterial.textContent = result.material || 'Could not determine';
        resValue.textContent = result.estimatedValue || '—';
        resValueNote.textContent = `${result.category || '—'} · Condition: ${result.condition || '—'}`;
      } catch (err) {
        console.error('[SW627 Scan]', err);
        scanStep2.classList.add('hidden');
        scanError.classList.remove('hidden');
        scanError.innerHTML = `
          <i class="fas fa-exclamation-triangle text-2xl text-red-400 mb-2"></i>
          <p class="text-xs text-red-400">${escapeHtml(err.message || 'Analysis failed. Try again.')}</p>
        `;
        showToast('Scan failed: ' + (err.message || 'Unknown error'), 'error');
      }
    });

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    $('scanAgainBtn').addEventListener('click', () => { cameraInput.value = ''; openScan(); });
    $('closeScan').addEventListener('click', closeScan);
    $('scanOverlay').addEventListener('click', closeScan);
    $('scanBtn')?.addEventListener('click', openScan);
    $('mobileScanBtn')?.addEventListener('click', openScan);
    $('heroScanBtn')?.addEventListener('click', openScan);

    // =================================================
    // LEGAL
    // =================================================
    const LEGAL = {
      tos: { title: 'Terms of Service', html: `
        <p><strong class="text-white">1. Platform Usage.</strong> SW627 is an admin-curated storefront. Public users cannot post or list items. All inventory is managed by authorized SW627 staff.</p>
        <p><strong class="text-white">2. Service Scope.</strong> SW627 operates strictly within Manila and Quezon City, Philippines. Orders outside these cities cannot be processed.</p>
        <p><strong class="text-white">3. Order Reservation.</strong> Items are reserved only upon confirmed payment.</p>
        <p><strong class="text-white">4. Right to Refuse Service.</strong> SW627 may cancel orders suspected of fraud, abuse, or repeated cancellations.</p>` },
      tnc: { title: 'Terms & Conditions', html: `
        <p><strong class="text-white">1. Replica Transparency.</strong> All items sold are high-tier replicas ("reps"). They are NOT authentic retail products. Batch tiers are disclosed on every listing.</p>
        <p><strong class="text-white">2. QC Photo Approval.</strong> Buyers must approve QC photos before dispatch. Once approved, the sale is final.</p>
        <p><strong class="text-white">3. No Return / No Exchange.</strong> Strictly no returns after approval, except when SW627 sent the wrong size or item — report within 24h with unboxing video.</p>
        <p><strong class="text-white">4. Meetup & Rider Liability.</strong> Risk passes to buyer at rider pickup or at meetup handover.</p>
        <p><strong class="text-white">5. Downpayment.</strong> COM orders require non-refundable downpayment; no-shows forfeit it.</p>` },
      privacy: { title: 'Privacy Policy', html: `
        <p><strong class="text-white">1. Data Collected.</strong> Name, Contact Number, Manila/QC Delivery Address, and payment reference for order fulfillment.</p>
        <p><strong class="text-white">2. Use of Data.</strong> Used only to process orders and coordinate deliveries. Not sold or shared except with logistics partners.</p>
        <p><strong class="text-white">3. Retention.</strong> Order records retained 90 days for warranty/dispute, then deleted.</p>
        <p><strong class="text-white">4. Compliance.</strong> Aligned with the Philippine Data Privacy Act (RA 10173). Request data deletion via support.</p>` }
    };

    function openLegal(key) {
      const d = LEGAL[key]; if (!d) return;
      legalTitle.textContent = d.title; legalContent.innerHTML = d.html;
      openModal(legalModal, legalPanel);
    }
    function closeLegal() { closeModal(legalModal, legalPanel); }

    // =================================================
    // EVENTS
    // =================================================
    document.querySelectorAll('.hub-pill, .hub-pill-mobile').forEach(p => {
      p.addEventListener('click', () => {
        const scope = p.classList.contains('hub-pill') ? '.hub-pill' : '.hub-pill-mobile';
        document.querySelectorAll(scope).forEach(x => {
          x.classList.remove('bg-white', 'text-black'); x.classList.add('text-zinc-400');
        });
        p.classList.add('bg-white', 'text-black'); p.classList.remove('text-zinc-400');
        state.activeHub = p.dataset.hub; render();
      });
    });

    document.querySelectorAll('.cat-chip').forEach(c => {
      c.addEventListener('click', () => {
        document.querySelectorAll('.cat-chip').forEach(x => {
          x.classList.remove('bg-white', 'text-black');
          x.classList.add('bg-[#18181B]', 'border', 'border-[#2E2E32]', 'text-zinc-400');
        });
        c.classList.add('bg-white', 'text-black');
        c.classList.remove('bg-[#18181B]', 'border', 'border-[#2E2E32]', 'text-zinc-400');
        state.activeCategory = c.dataset.cat; render();
      });
    });

    $('batchFilter').addEventListener('change', e => { state.batch = e.target.value; render(); });
    $('priceFilter').addEventListener('change', e => { state.price = e.target.value; render(); });

    const onSearch = debounce(v => { state.search = v; render(); }, 200);
    $('searchDesktop').addEventListener('input', e => onSearch(e.target.value));
    $('searchMobile').addEventListener('input', e => onSearch(e.target.value));

    $('cartBtn').addEventListener('click', openCart);
    $('mobileCartBtn').addEventListener('click', openCart);
    $('closeCartBtn').addEventListener('click', closeCart);
    $('cartOverlay').addEventListener('click', closeCart);
    $('checkoutBtn').addEventListener('click', openCheckout);

    $('closeCheckoutBtn').addEventListener('click', closeCheckout);
    $('checkoutOverlay').addEventListener('click', closeCheckout);
    $('checkoutForm').addEventListener('submit', submitOrder);

    $('closeQuickView').addEventListener('click', () => closeModal(quickViewModal, quickViewPanel));
    $('quickViewOverlay').addEventListener('click', () => closeModal(quickViewModal, quickViewPanel));

    $('staffBtn').addEventListener('click', openStaffLogin);
    $('staffBtnFooter').addEventListener('click', openStaffLogin);
    $('mobileStaffBtn').addEventListener('click', openStaffLogin);
    $('closeStaffLogin').addEventListener('click', closeStaffLogin);
    $('staffLoginOverlay').addEventListener('click', closeStaffLogin);
    $('staffLoginSubmit').addEventListener('click', doStaffLogin);
    $('staffPasscode').addEventListener('keydown', e => { if (e.key === 'Enter') doStaffLogin(); });

    $('closeAdminBtn').addEventListener('click', closeAdmin);
    $('adminOverlay').addEventListener('click', closeAdmin);
    $('adminAddForm').addEventListener('submit', submitAdminItem);

    document.querySelectorAll('.legal-link').forEach(b => {
      b.addEventListener('click', () => openLegal(b.dataset.legal));
    });
    $('closeLegalModal').addEventListener('click', closeLegal);
    $('legalOverlay').addEventListener('click', closeLegal);

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault(); openStaffLogin();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault(); openScan();
      }
    });

    $('browseBtn').addEventListener('click', () => productGrid.scrollIntoView({ behavior: 'smooth' }));

    boot();
  })();
</script>
