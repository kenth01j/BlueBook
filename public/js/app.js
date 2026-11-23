const state = {
  user: null,
  token: localStorage.getItem('bb_token') || '',
  products: [],
  orders: [],
  payments: [],
  students: [],
  adminStats: null,
  cashierDashboard: null,
  page: 'dashboard',
  paymentPreviewUrl: '',
  studentSearchTimer: null,
  stockRefreshTimer: null,
  orderNotificationTimer: null,
  cashierRefreshTimer: null,
  reportPeriod: 'daily',
  adminReport: null,
  reportLoading: false,
  reportError: '',
  counterExpirationHours: 8,
  verifiedReceiptIds: null,
  dismissedNotificationOrderIds: new Set(),
  notificationSwipe: null,
  notificationDismissalPending: new Set(),
  notificationQrCache: {},
  notificationQrErrors: {},
  notificationQrLoading: new Set(),
  cashierScannerStream: null,
  cashierScannerFrame: null,
  cashierScanBusy: false,
  cashierImageScanBusy: false
};

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.body.classList.toggle('dark', isDark);
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  $$('[data-theme-toggle]').forEach(button => {
    const icon = $('[data-theme-toggle-icon]', button);
    if (icon) icon.textContent = isDark ? '☼' : '☾';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.setAttribute('aria-pressed', String(isDark));
  });
}

function toggleTheme() {
  const theme = document.body.classList.contains('dark') ? 'light' : 'dark';
  localStorage.setItem('bb_theme', theme);
  applyTheme(theme);
}

applyTheme(localStorage.getItem('bb_theme') === 'dark' ? 'dark' : 'light');

const money = n => `₱${Number(n || 0).toFixed(2)}`;
const isOnlinePaymentMethod = method => ['GCASH', 'MAYA'].includes(method);
const paymentMethodLabel = method =>
  method === 'GCASH' ? 'GCash'
    : method === 'MAYA' ? 'Maya'
      : method === 'CASH' ? 'At counter' : 'Unknown';

function paymentQrMarkup(method) {
  const imagePath = {
    GCASH: '/images/gcash-payment-qr.png',
    MAYA: '/images/maya-payment-qr.png'
  }[method];
  if (!imagePath) return '';

  return `
    <div class="payment-qr-wrap">
      <img class="payment-qr-image" src="${imagePath}" alt="${paymentMethodLabel(method)} payment QR code">
    </div>
  `;
}

function claimReceiptScanner() {
  if (!['cashier', 'admin'].includes(state.user?.role)) return '';

  return `
    <section class="panel cashier-queue">
      <div class="panel-title">
        <div>
          <h3>Scan claim receipt</h3>
          <p>Scan a valid receipt when physically handing the Bluebook to the student.</p>
        </div>
        <button class="btn btn-light btn-small" type="button" data-start-cashier-camera>
          Open camera
        </button>
      </div>
      <p class="cashier-scan-warning">
        Camera scans claim immediately. For an uploaded image, review the decoded QR and select Verify and claim.
      </p>
      <form class="cashier-scan-form" data-cashier-scan-form>
        <label for="cashierReceiptScanInput">Receipt QR content</label>
        <div class="cashier-scan-input-row">
          <input
            id="cashierReceiptScanInput"
            name="qrContent"
            type="text"
            autocomplete="off"
            maxlength="128"
            placeholder="Scan with a USB QR scanner"
          >
          <button class="btn btn-primary" type="submit">Verify and claim</button>
        </div>
        <label for="cashierReceiptQrFile">Or upload a claim receipt QR image</label>
        <input
          id="cashierReceiptQrFile"
          class="cashier-qr-upload"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          data-receipt-qr-upload
        >
        <small>QR images are decoded on this device. USB/keyboard scanners can also scan into the field.</small>
      </form>
      <video id="cashierReceiptScannerVideo" class="cashier-scanner-video hidden" playsinline muted></video>
      <p id="cashierReceiptScannerStatus" class="cashier-scanner-status" role="status">
        Use the camera, upload a QR image, or use a USB/keyboard scanner.
      </p>
    </section>
  `;
}

const escapeHtml = value =>
  String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

async function api(url, options = {}) {
  const headers = {
    ...(options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && state.token) {
      logout(false);
    }

    throw new Error(data.message || `Request failed (${response.status})`);
  }

  return data;
}

function toast(message) {
  const el = $('#toast');

  if (!el) {
    console.log(message);
    return;
  }

  el.textContent = message;
  el.classList.add('show');

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    el.classList.remove('show');
  }, 3200);
}

function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');

  if (button) {
    button.disabled = busy;
    button.dataset.originalText ||= button.innerHTML;
    button.innerHTML = busy
      ? 'Please wait…'
      : button.dataset.originalText;
  }
}

function setAuthTab(tab) {
  $$('.auth-tab').forEach(button => {
    button.classList.toggle(
      'active',
      button.dataset.authTab === tab
    );
  });

  $('#loginForm').classList.toggle('hidden', tab !== 'login');
  $('#registerForm').classList.toggle('hidden', tab !== 'register');

  $('#authTitle').textContent =
    tab === 'login'
      ? 'Sign in to your account'
      : 'Create your student account';

  $('#authSubtitle').textContent =
    tab === 'login'
      ? 'Access your reservations and Bluebook orders.'
      : 'Register to reserve and purchase your Bluebook online.';
}

function showApp(user) {
  state.user = user;

  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');

  $('#headerName').textContent = user.name;

  $('#headerRole').textContent =
    user.role === 'admin'
      ? 'Administrator'
      : user.role === 'cashier'
        ? 'Cashier'
        : user.role === 'staff'
          ? 'Staff account'
          : 'Student account';

  $('#avatarInitial').textContent =
    user.name.charAt(0).toUpperCase();

  const isStudent = user.role === 'student';
  const isCashier = user.role === 'cashier';
  $('#studentNotificationArea').classList.toggle('hidden', !isStudent);
  setStudentNotificationPanel(false);
  $('#studentLookupNav').classList.toggle('hidden', user.role !== 'admin');
  $('#cashierStudentLookupNav').classList.toggle('hidden', !isCashier);
  $('#adminReportsNav').classList.toggle('hidden', user.role !== 'admin');
  $('#sidebarWorkspaceLabel').textContent = isCashier ? 'CASHIER WORKSPACE' : 'WORKSPACE';

  $('#studentNav').classList.toggle('hidden', !isStudent);
  $('#adminNav').classList.toggle('hidden', isStudent || isCashier);
  $('#cashierNav').classList.toggle('hidden', !isCashier);

  navigate(isStudent ? 'dashboard' : isCashier ? 'cashierDashboard' : 'adminDashboard');
}

function logout(showMessage = true) {
  stopStudentStockRefresh();
  stopCashierDashboardRefresh();
  state.user = null;
  state.token = '';
  state.products = [];
  state.orders = [];
  state.payments = [];
  state.students = [];
  state.adminStats = null;
  state.cashierDashboard = null;
  state.adminReport = null;
  state.reportError = '';
  state.verifiedReceiptIds = null;
  state.dismissedNotificationOrderIds.clear();
  state.notificationDismissalPending.clear();
  state.notificationQrCache = {};
  state.notificationQrErrors = {};
  state.notificationQrLoading.clear();
  stopCashierReceiptCamera();
  updateStudentNotificationUI();

  localStorage.removeItem('bb_token');

  $('#appView').classList.add('hidden');
  $('#authView').classList.remove('hidden');
  $('#sidebar').classList.remove('open');

  setAuthTab('login');

  if (showMessage) {
    toast('You have signed out.');
  }
}

async function refreshData() {
  const requests = [
    api('/api/products'),

    api(
      state.user.role === 'student'
        ? '/api/orders/mine'
        : '/api/orders'
    )
  ];

  if (state.user.role === 'admin') {
    requests.push(api('/api/admin/dashboard'));
    requests.push(api('/api/payments'));
    requests.push(api('/api/admin/settings'));
  }
  if (state.user.role === 'cashier') {
    requests.push(api('/api/payments'));
  }
  if (state.user.role === 'cashier') {
    requests.push(api('/api/cashier/dashboard'));
  }
  let notificationDismissalIndex = -1;
  if (state.user.role === 'student') {
    notificationDismissalIndex = requests.length;
    requests.push(api('/api/notifications/dismissed'));
  }

  const results = await Promise.all(requests);

  const [productData, orderData] = results;

  state.products = productData.products || [];
  state.orders = orderData.orders || [];
  if (state.user.role === 'student') {
    state.dismissedNotificationOrderIds = new Set(
      results[notificationDismissalIndex]?.orderIds || []
    );
    trackVerifiedPayments(state.orders, true);
    updateStudentNotificationUI();
  }
  state.adminStats = state.user.role === 'admin'
    ? results[2]?.dashboard || null
    : null;
  state.counterExpirationHours = state.user.role === 'admin'
    ? Number(results[4]?.counterExpirationHours || 8)
    : state.counterExpirationHours;
  state.cashierDashboard = state.user.role === 'cashier'
    ? results[3]?.dashboard || null
    : null;
  state.payments = ['admin', 'cashier'].includes(state.user.role)
    ? results[state.user.role === 'admin' ? 3 : 2]?.payments || []
    : [];
}

function stopStudentStockRefresh() {
  if (state.stockRefreshTimer) clearInterval(state.stockRefreshTimer);
  if (state.orderNotificationTimer) clearInterval(state.orderNotificationTimer);
  state.stockRefreshTimer = null;
  state.orderNotificationTimer = null;
}

function trackVerifiedPayments(orders, announceNew) {
  const verifiedOrders = orders.filter(order =>
    order.paymentStatus === 'VERIFIED' &&
    order.receiptNumber &&
    ['PAID', 'CLAIMED'].includes(order.status)
  );
  const currentIds = new Set(verifiedOrders.map(order => String(order.id)));

  if (state.verifiedReceiptIds && announceNew) {
    const newCount = [...currentIds].filter(id => !state.verifiedReceiptIds.has(id)).length;
    if (newCount > 0) {
      toast(newCount === 1
        ? 'Payment verified. Your claim receipt and QR are ready.'
        : `${newCount} payments verified. Your claim receipts and QRs are ready.`);
    }
  }

  state.verifiedReceiptIds = currentIds;
}

function verifiedPaymentOrders() {
  return state.orders
    .filter(order =>
      order.paymentStatus === 'VERIFIED' &&
      order.receiptNumber &&
      ['PAID', 'CLAIMED'].includes(order.status) &&
      !state.dismissedNotificationOrderIds.has(String(order.id))
    )
    .slice(0, 5);
}

async function dismissStudentNotification(orderId, item = null) {
  const id = String(orderId);
  if (
    !id ||
    state.dismissedNotificationOrderIds.has(id) ||
    state.notificationDismissalPending.has(id)
  ) return;

  state.notificationDismissalPending.add(id);
  if (item) {
    item.style.transform = '';
    item.style.opacity = '';
    item.classList.remove('is-dragging');
    item.classList.add('is-dismissing');
  }
  try {
    await api(`/api/notifications/${encodeURIComponent(id)}/dismiss`, {
      method: 'POST',
      body: '{}'
    });
    state.dismissedNotificationOrderIds.add(id);
    updateStudentNotificationUI();
  } catch (error) {
    if (item) {
      item.classList.remove('is-dismissing', 'is-dragging');
      item.style.transform = '';
      item.style.opacity = '';
    }
    toast(`Unable to dismiss notification: ${error.message}`);
  } finally {
    state.notificationDismissalPending.delete(id);
  }
}

function renderStudentNotificationList() {
  const list = $('#studentNotificationList');
  if (!list) return;

  const orders = verifiedPaymentOrders();
  if (!orders.length) {
    list.innerHTML = '<div class="notification-empty">No new verified payment notifications.</div>';
    return;
  }

  list.innerHTML = `
    <p class="notification-swipe-hint">Swipe a notification right or use Dismiss to clear it.</p>
    ${orders.map(order => {
    const id = String(order.id);
    const qrImage = state.notificationQrCache[id];
    const qrError = state.notificationQrErrors[id];
    const qrContent = qrImage
      ? `<img class="notification-qr" src="${escapeHtml(qrImage)}" alt="Claim QR for order ${escapeHtml(order.ref)}">`
      : qrError
        ? `<p class="notification-qr-error" role="alert">QR unavailable: ${escapeHtml(qrError)}</p>`
        : '<div class="notification-qr-loading">Loading claim QR…</div>';

    return `
      <article class="notification-item">
        <div class="notification-item-heading">
          <strong><span aria-hidden="true">✓</span> Payment verified</strong>
          <span class="notification-item-status">Receipt ready</span>
        </div>
        <p class="notification-order">Order ${escapeHtml(order.ref)}</p>
        <p class="notification-receipt">
          Receipt ${escapeHtml(order.receiptNumber)} · ${escapeHtml(order.productName)} × ${order.quantity} · ${money(order.total)}
        </p>
        <div class="notification-qr-wrap">${qrContent}</div>
        <div class="notification-actions">
          <button class="btn btn-light btn-small" data-show-receipt="${escapeHtml(order.receiptNumber)}">
            View receipt
          </button>
          <button class="btn btn-light btn-small" data-download-reference="${escapeHtml(id)}">
            Download PDF
          </button>
          <button class="btn btn-outline btn-small" data-download-claim-qr="${escapeHtml(id)}">
            Download QR
          </button>
          <button
            class="btn btn-light btn-small notification-dismiss"
            data-dismiss-notification="${escapeHtml(id)}"
            aria-label="Dismiss notification for order ${escapeHtml(order.ref)}"
          >
            Dismiss
          </button>
        </div>
      </article>
    `;
  }).join('')}
  `;
}

function updateStudentNotificationUI() {
  const area = $('#studentNotificationArea');
  const badge = $('#studentNotificationCount');
  const button = $('#studentNotificationButton');
  const panel = $('#studentNotificationPanel');
  if (!area || !badge || !button || !panel) return;

  const count = state.user?.role === 'student' ? verifiedPaymentOrders().length : 0;
  area.classList.toggle('hidden', state.user?.role !== 'student');
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('hidden', count === 0);
  button.setAttribute('aria-label', count
    ? `Notifications, ${count} verified payment${count === 1 ? '' : 's'}`
    : 'Notifications, no new verified payments');

  renderStudentNotificationList();
  if (!panel.classList.contains('hidden')) {
    loadStudentNotificationQrs();
  }
}

function setStudentNotificationPanel(open) {
  const panel = $('#studentNotificationPanel');
  const button = $('#studentNotificationButton');
  if (!panel || !button) return;

  const shouldOpen = open && state.user?.role === 'student';
  panel.classList.toggle('hidden', !shouldOpen);
  button.setAttribute('aria-expanded', String(shouldOpen));
  if (shouldOpen) updateStudentNotificationUI();
}

async function loadStudentNotificationQrs() {
  const orders = verifiedPaymentOrders();
  await Promise.all(orders.map(async order => {
    const id = String(order.id);
    if (state.notificationQrCache[id] || state.notificationQrErrors[id] || state.notificationQrLoading.has(id)) {
      return;
    }

    state.notificationQrLoading.add(id);
    try {
      const data = await api(`/api/orders/${encodeURIComponent(id)}/qr`);
      state.notificationQrCache[id] = data.qr;
    } catch (error) {
      state.notificationQrErrors[id] = error.message;
    } finally {
      state.notificationQrLoading.delete(id);
    }
  }));
  renderStudentNotificationList();
}

function syncStudentStockRefresh(page) {
  stopStudentStockRefresh();
  if (state.user?.role !== 'student') return;

  const timer = async () => {
    try {
      if (['dashboard', 'catalog'].includes(page)) {
        await refreshStudentStock();
      } else {
        await refreshStudentOrders();
      }
    } catch (error) {
      stopStudentStockRefresh();
      toast(`Live student updates paused: ${error.message}`);
    }
  };

  if (['dashboard', 'catalog'].includes(page)) {
    state.stockRefreshTimer = setInterval(timer, 30000);
  } else if (page === 'orders') {
    state.orderNotificationTimer = setInterval(timer, 30000);
  }
}

function stopCashierDashboardRefresh() {
  if (state.cashierRefreshTimer) clearInterval(state.cashierRefreshTimer);
  state.cashierRefreshTimer = null;
}

function stopCashierReceiptCamera() {
  if (state.cashierScannerFrame !== null) {
    cancelAnimationFrame(state.cashierScannerFrame);
    state.cashierScannerFrame = null;
  }
  if (state.cashierScannerStream) {
    state.cashierScannerStream.getTracks().forEach(track => track.stop());
    state.cashierScannerStream = null;
  }
  const video = $('#cashierReceiptScannerVideo');
  if (video) {
    video.pause();
    video.srcObject = null;
    video.classList.add('hidden');
  }
}

function syncCashierDashboardRefresh(page) {
  stopCashierDashboardRefresh();
  if (state.user?.role !== 'cashier' || page !== 'cashierDashboard') return;

  state.cashierRefreshTimer = setInterval(async () => {
    try {
      await refreshData();
      if (state.page === 'cashierDashboard' && !state.cashierScannerStream) {
        renderPage('cashierDashboard');
      }
    } catch (error) {
      stopCashierDashboardRefresh();
      toast(`Live cashier updates paused: ${error.message}`);
    }
  }, 30000);
}

async function refreshStudentStock() {
  const [productData, orderData, dismissalData] = await Promise.all([
    api('/api/products'),
    api('/api/orders/mine'),
    api('/api/notifications/dismissed')
  ]);
  state.products = productData.products || [];
  state.orders = orderData.orders || [];
  state.dismissedNotificationOrderIds = new Set(dismissalData.orderIds || []);
  trackVerifiedPayments(state.orders, true);
  updateStudentOrderViews();

  $$('[data-student-product-grid]').forEach(grid => {
    grid.innerHTML = state.products.map(productCard).join('') ||
      '<div class="empty-state">No Bluebooks are currently listed.</div>';
  });
  const availableUnits = state.products.reduce(
    (total, product) => total + Number(product.stock || 0),
    0
  );
  const availableStock = $('#studentAvailableStock');
  if (availableStock) availableStock.textContent = availableUnits;

  const updatedAt = new Date().toLocaleTimeString();
  const dashboardStatus = $('#studentStockUpdated');
  const catalogStatus = $('#catalogStockUpdated');
  if (dashboardStatus) dashboardStatus.textContent = `Updated ${updatedAt} · refreshes every 30 seconds`;
  if (catalogStatus) catalogStatus.textContent = `Stock updated ${updatedAt} · refreshes every 30 seconds`;
}

async function refreshStudentOrders() {
  const [data, dismissalData] = await Promise.all([
    api('/api/orders/mine'),
    api('/api/notifications/dismissed')
  ]);
  state.orders = data.orders || [];
  state.dismissedNotificationOrderIds = new Set(dismissalData.orderIds || []);
  trackVerifiedPayments(state.orders, true);
  updateStudentOrderViews();
}

function updateStudentOrderViews() {
  const activeOrders = state.orders.filter(order =>
    ['RESERVED', 'PENDING_PAYMENT', 'PAID'].includes(order.status)
  ).length;
  const claimedOrders = state.orders.filter(order => order.status === 'CLAIMED').length;
  const activeCount = $('#studentActiveOrdersCount');
  const claimedCount = $('#studentClaimedOrdersCount');

  if (activeCount) activeCount.textContent = activeOrders;
  if (claimedCount) claimedCount.textContent = claimedOrders;

  const recentOrders = $('#studentRecentOrdersTable');
  if (recentOrders) recentOrders.innerHTML = ordersTable(state.orders.slice(0, 5));

  const ordersTableContainer = $('#studentOrdersTable');
  if (ordersTableContainer) ordersTableContainer.innerHTML = ordersTable(state.orders);

  $$('[data-student-payment-notifications]').forEach(container => {
    container.innerHTML = studentVerifiedPaymentNotifications();
  });
  updateStudentNotificationUI();
}

async function navigate(page) {
  const role = state.user?.role;
  const allowedPages = {
    student: ['dashboard', 'catalog', 'orders'],
    cashier: ['cashierDashboard', 'manageStudents'],
    admin: ['adminDashboard', 'inventory', 'manageOrders', 'reports', 'manageStudents'],
    staff: ['adminDashboard', 'inventory', 'manageOrders']
  };
  const defaultPage = role === 'student'
    ? 'dashboard'
    : role === 'cashier'
      ? 'cashierDashboard'
      : 'adminDashboard';
  if (!allowedPages[role]?.includes(page)) page = defaultPage;

  const nextHasReceiptScanner =
    (role === 'cashier' && page === 'cashierDashboard') ||
    (role === 'admin' && page === 'manageOrders');
  if (!nextHasReceiptScanner) stopCashierReceiptCamera();
  state.page = page;

  $$('.page').forEach(p => p.classList.remove('active'));

  const target = $(`#page-${page}`);

  if (!target) return;

  target.classList.add('active');

  $$('.nav-link').forEach(button => {
    button.classList.toggle(
      'active',
      button.dataset.page === page
    );
  });

  const labels = {
    dashboard: 'Overview',
    catalog: 'Bluebook catalog',
    orders: 'My orders',
    adminDashboard: 'Overview',
    inventory: 'Inventory',
    manageOrders: 'Orders & claims',
    reports: 'Reports',
    manageStudents: 'Student lookup',
    cashierDashboard: 'Payment desk'
  };

  $('#breadcrumbPage').textContent = labels[page] || 'Overview';

  $('#sidebar').classList.remove('open');

  try {
    await refreshData();
    renderPage(page);
    syncStudentStockRefresh(page);
    syncCashierDashboardRefresh(page);
    if (page === 'reports' && state.user.role === 'admin') {
      loadAdminReport(state.reportPeriod);
    }
  } catch (error) {
    toast(error.message);
  }
}
function productArt() {
  return `
    <div class="product-art">
      <div class="book-illustration">
        <b>BB</b>
        <span>EXAM BOOK</span>
      </div>
      <span class="stock-tag">Official Bluebook</span>
    </div>
  `;
}

function productCard(p) {
  return `
    <article class="product-card">
      ${productArt()}

      <div class="product-info">
        <h4>${escapeHtml(p.name)}</h4>

        <p>${escapeHtml(p.description)}</p>

        <div class="product-bottom">
          <div class="product-price">
            ${money(p.price)} <small>/ piece</small>
          </div>

          <button
            class="btn btn-primary btn-small"
            data-order-product="${p.id}"
            ${p.stock <= 0 ? 'disabled' : ''}
          >
            Reserve / Buy
          </button>
        </div>

        <small class="muted" data-product-available="${escapeHtml(p.id)}">${p.stock} available</small>
      </div>
    </article>
  `;
}

function studentVerifiedPaymentNotifications() {
  const verifiedOrders = verifiedPaymentOrders();

  if (!verifiedOrders.length) return '';

  return `
    <div class="student-notifications" role="region" aria-label="Verified payment notifications" aria-live="polite">
      ${verifiedOrders.map(order => `
        <article class="student-payment-notice" role="status">
          <div class="student-payment-notice-copy">
            <strong><span aria-hidden="true">✓</span> Payment verified</strong>
            <p>
              Your payment for ${escapeHtml(order.ref)} is confirmed.
              Receipt ${escapeHtml(order.receiptNumber)} and the claim QR are ready.
            </p>
          </div>
          <div class="student-payment-notice-actions">
            <button class="btn btn-light btn-small" data-show-receipt="${escapeHtml(order.receiptNumber)}">
              View receipt &amp; QR
            </button>
            <button class="btn btn-light btn-small" data-download-reference="${escapeHtml(order.id)}">
              Download receipt PDF
            </button>
            <button class="btn btn-outline btn-small" data-download-claim-qr="${escapeHtml(order.id)}">
              Download QR image
            </button>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function statusClass(status) {
  return ({
    PAID: 'paid',
    CLAIMED: 'claimed',
    RESERVED: 'reserved',
    PENDING_PAYMENT: 'pending',
    EXPIRED: 'expired',
    CANCELLED: 'cancelled'
  })[status] || '';
}

function prettyStatus(status) {
  return String(status)
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function ordersTable(orders, admin = false) {
  const canCancelOrders = state.user?.role === 'admin';
  if (!orders.length) {
    return `
      <div class="empty-state">
        <div style="font-size:27px">▣</div>
        <b>No orders to display</b>
        <span>
          Orders will appear here after a reservation
          or purchase is made.
        </span>
      </div>
    `;
  }

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            ${admin ? '<th>Cashier #</th>' : ''}
            <th>Order reference</th>
            ${admin ? '<th>Student</th>' : ''}
            <th>Type</th>
            <th>Quantity</th>
            <th>Total</th>
            <th>Payment</th>
            <th>Status</th>
            <th>Date</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          ${orders.map(o => `
            <tr>
              ${admin ? `<td>${escapeHtml(o.verifiedBy || '—')}</td>` : ''}
              <td>
                <strong>${escapeHtml(o.ref)}</strong>
              </td>

              ${admin ? `
                <td>${escapeHtml(o.studentName)}</td>
              ` : ''}

              <td>
                ${o.type === 'RESERVATION'
                  ? 'Reservation'
                  : 'Online purchase'}
              </td>

              <td>${o.quantity}</td>

              <td>${money(o.total)}</td>

              <td>${paymentMethodLabel(o.paymentMethod)}</td>

              <td>
                <span class="status ${statusClass(o.status)}">
                  ${prettyStatus(o.status)}
                </span>
                ${['RESERVED', 'PENDING_PAYMENT'].includes(o.status) && o.expiresAt
                  ? `<small class="muted" style="display:block;margin-top:5px">Expires ${new Date(o.expiresAt).toLocaleString()}</small>`
                  : ''}
                ${admin && o.status === 'PAID'
                  ? '<small class="muted" style="display:block;margin-top:5px">Payment verified · ready to claim</small>'
                  : ''}
                ${o.paymentStatus === 'REJECTED' && o.paymentRemarks
                  ? `<small class="muted" style="display:block;margin-top:5px">Receipt rejected: ${escapeHtml(o.paymentRemarks)}</small>`
                  : ''}
                ${o.status === 'CANCELLED' && o.cancellationReason
                  ? `<small class="muted" style="display:block;margin-top:5px">Cancellation: ${escapeHtml(o.cancellationReason.slice(0, 160))}</small>`
                  : ''}
                ${o.status === 'CANCELLED' && o.cancelledBy
                  ? `<small class="muted" style="display:block;margin-top:5px">Cancelled by ${escapeHtml(o.cancelledBy)}</small>`
                  : ''}
                ${o.manualRefundRequired
                  ? '<small class="muted" style="display:block;margin-top:5px">Manual refund required</small>'
                  : ''}
              </td>

              <td>
                ${new Date(o.createdAt).toLocaleDateString()}
              </td>

              ${admin ? `
                <td>
                  <div class="order-action-buttons">
                    ${o.status === 'PENDING_PAYMENT' && isOnlinePaymentMethod(o.paymentMethod)
                      ? o.paymentStatus === 'PENDING'
                        ? `
                          <button
                            class="btn btn-light btn-small"
                            data-review-payment="${o.paymentId}"
                          >
                            Review &amp; verify ${paymentMethodLabel(o.paymentMethod)} receipt
                          </button>
                        `
                        : '<span class="muted">Waiting for student receipt</span>'
                      : o.status === 'RESERVED' && o.paymentMethod === 'CASH'
                        ? `
                          <button
                            class="btn btn-light btn-small"
                            data-counter-payment="${o.id}"
                          >
                            Confirm counter payment
                          </button>
                        `
                        : o.status === 'PAID' && o.paymentStatus === 'VERIFIED'
                          ? `
                            <button
                              class="btn btn-light btn-small"
                              data-claim-order="${o.id}"
                            >
                              Confirm student claim
                            </button>
                          `
                          : '—'}
                    ${canCancelOrders && ['RESERVED', 'PENDING_PAYMENT', 'PAID'].includes(o.status) ? `
                      <button
                        class="btn btn-light btn-small"
                        data-cancel-order="${o.id}"
                        aria-label="Cancel order ${escapeHtml(o.ref)}"
                      >
                        Cancel
                      </button>
                    ` : ''}
                  </div>
                </td>
              ` : `
                <td>
                  ${['RESERVED', 'PENDING_PAYMENT', 'PAID'].includes(o.status) ? `
                    <button
                      class="btn btn-light btn-small"
                      data-cancel-order="${o.id}"
                      aria-label="Cancel order ${escapeHtml(o.ref)}"
                      style="margin-bottom:5px"
                    >
                      Cancel order
                    </button>
                  ` : ''}
                  ${o.status === 'PENDING_PAYMENT' && isOnlinePaymentMethod(o.paymentMethod)
                    ? o.paymentStatus === 'PENDING'
                      ? '<span class="muted">Receipt awaiting verification</span>'
                      : `
                        <button class="btn btn-light btn-small" data-upload-payment="${o.id}">
                          ${o.paymentStatus === 'REJECTED' ? 'Resubmit receipt' : `Upload ${paymentMethodLabel(o.paymentMethod)} receipt`}
                        </button>
                      `
                    : o.status === 'RESERVED' && o.paymentMethod === 'CASH'
                      ? `
                        <button class="btn btn-light btn-small" data-show-counter-qr="${o.id}">
                          Counter payment QR
                        </button>
                        <small class="muted" style="display:block;margin-top:5px">Pay by ${new Date(o.expiresAt).toLocaleString()}</small>
                      `
                      : ['PAID', 'CLAIMED'].includes(o.status) && o.receiptNumber
                        ? `
                          <button class="btn btn-light btn-small" data-show-receipt="${escapeHtml(o.receiptNumber)}">
                            View claim receipt
                          </button>
                        `
                        : `
                     <span class="muted">No claim receipt</span>
                      `}
                </td>
              `}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function studentDashboard() {
  const availableUnits = state.products.reduce(
    (total, product) => total + Number(product.stock || 0),
    0
  );
  const pending = state.orders.filter(o =>
    ['RESERVED', 'PENDING_PAYMENT', 'PAID'].includes(o.status)
  ).length;

  const claimed = state.orders.filter(o =>
    o.status === 'CLAIMED'
  ).length;

  return `
    <div class="welcome-banner">
      <div>
        <span class="eyebrow eyebrow-light">STUDENT PORTAL</span>

        <h2>
          Good day,
          ${escapeHtml(state.user.name.split(' ')[0])}!
        </h2>

        <p>
          Your Bluebook, ready when you need it.
          Reserve online and claim on campus.
        </p>
      </div>

      <button class="btn" data-go="catalog">
        Browse Bluebooks <span>→</span>
      </button>
    </div>

    <div data-student-payment-notifications>
      ${studentVerifiedPaymentNotifications()}
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-top">ACTIVE ORDERS</div>
        <div class="stat-value" id="studentActiveOrdersCount">${pending}</div>
        <div class="stat-foot">Orders awaiting completion</div>
      </div>

      <div class="stat-card">
        <div class="stat-top">CLAIMED ORDERS</div>
        <div class="stat-value" id="studentClaimedOrdersCount">${claimed}</div>
        <div class="stat-foot">Successfully released</div>
      </div>

      <div class="stat-card">
        <div class="stat-top">AVAILABLE BLUEBOOKS</div>
        <div class="stat-value" id="studentAvailableStock">${availableUnits}</div>
        <div class="stat-foot">Unreserved units across listed products</div>
      </div>

      <div class="stat-card">
        <div class="stat-top">ORDERING</div>
        <div class="stat-value">Online</div>
        <div class="stat-foot">Reservation and purchasing</div>
      </div>
    </div>

    <div class="section-row student-stock-heading">
      <div>
        <h3>Available Bluebook stock</h3>
        <small id="studentStockUpdated" class="muted">
          Updated ${new Date().toLocaleTimeString()} · refreshes every 30 seconds
        </small>
      </div>
      <div class="student-stock-actions">
        <button class="text-link" data-refresh-student-stock>Refresh stock</button>
        <button class="text-link" data-go="catalog">View catalog →</button>
      </div>
    </div>

    <div class="product-grid" data-student-product-grid>
      ${
        state.products.map(productCard).join('') ||
        '<div class="empty-state">No Bluebooks are currently listed.</div>'
      }
    </div>

    <div class="section-row">
      <h3>Recent orders</h3>
      <button class="text-link" data-go="orders">
        View all →
      </button>
    </div>

    <div id="studentRecentOrdersTable">${ordersTable(state.orders.slice(0, 5))}</div>
  `;
}

function catalogPage() {
  return `
    <div class="page-heading">
      <div>
        <span class="eyebrow eyebrow-blue">STUDENT STORE</span>
        <h1>Bluebook catalog</h1>
        <p>
          Check availability and choose how you want
          to get your Bluebook.
        </p>
      </div>
    </div>

    <div data-student-payment-notifications>
      ${studentVerifiedPaymentNotifications()}
    </div>

    <div class="student-stock-toolbar">
      <span id="catalogStockUpdated" class="muted">
        Stock updated ${new Date().toLocaleTimeString()} · refreshes every 30 seconds
      </span>
      <button class="btn btn-light btn-small" data-refresh-student-stock>Refresh stock</button>
    </div>

    <div class="welcome-banner">
      <div>
        <span class="eyebrow eyebrow-light">QUICK & CONVENIENT</span>
        <h2>Skip the line. Order ahead.</h2>
        <p>
          Reserve now and pay at the counter, or purchase
          online using an approved payment option.
        </p>
      </div>
    </div>

    <div class="product-grid" data-student-product-grid>
      ${
        state.products.map(productCard).join('') ||
        '<div class="empty-state">No products available right now.</div>'
      }
    </div>
  `;
}

function ordersPage() {
  return `
    <div class="page-heading">
      <div>
        <span class="eyebrow eyebrow-blue">ORDER ACTIVITY</span>
        <h1>My orders</h1>
        <p>
          Track your Bluebook reservations, purchases,
          and claiming status.
        </p>
      </div>
    </div>

    <div data-student-payment-notifications>
      ${studentVerifiedPaymentNotifications()}
    </div>

    <div id="studentOrdersTable">${ordersTable(state.orders)}</div>
  `;
}

function inventoryTable() {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>SKU</th>
            <th>Price</th>
            <th>Available stock</th>
            <th>Reserved</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          ${state.products.map(p => `
            <tr>
              <td><strong>${escapeHtml(p.name)}</strong></td>
              <td>${escapeHtml(p.sku)}</td>
              <td>
                ${money(p.price)}
                <button class="btn btn-light btn-small" data-edit-price="${p.id}">
                  Update price
                </button>
              </td>
              <td>${p.stock}</td>
              <td>${p.reserved || 0}</td>
              <td>
                <button
                  class="btn btn-light btn-small"
                  data-edit-stock="${p.id}"
                >
                  Update stock
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
function adminDashboard() {
  // Use the statistics returned by the MongoDB admin endpoint.
  // Fallback calculations are for non-admin staff accounts.
  const stats = state.adminStats || {
    totalStudents: 0,

    totalBluebooksSold: state.orders
      .filter(o => o.status === 'CLAIMED')
      .reduce((sum, o) => sum + Number(o.quantity || 0), 0),

    totalReservations: state.orders
      .filter(o =>
        o.type === 'RESERVATION' &&
        !['EXPIRED', 'CANCELLED'].includes(o.status)
      ).length,

    totalRevenue: state.orders
      .filter(o => o.status === 'CLAIMED')
      .reduce((sum, o) => sum + Number(o.total || 0), 0),

    pendingPayments: state.orders
      .filter(o =>
        ['RESERVED', 'PENDING_PAYMENT'].includes(o.status)
      ).length,

    availableStock: state.products
      .reduce((sum, p) => sum + Number(p.stock || 0), 0)
  };
  const weeklySales = stats.weeklySales || { revenue: 0, quantity: 0, orders: 0 };
  const monthlySales = stats.monthlySales || { revenue: 0, quantity: 0, orders: 0 };

  return `
    <div class="page-heading">
      <div>
        <span class="eyebrow eyebrow-blue">ADMINISTRATION</span>
        <h1>Dashboard overview</h1>
        <p>
          Monitor Bluebook operations, inventory,
          and student orders.
        </p>
      </div>

      <button
        class="btn btn-primary btn-small"
        data-go="manageOrders"
      >
        Manage orders →
      </button>
    </div>

    <div class="stats-grid">

      <div class="stat-card">
        <div class="stat-top">REGISTERED STUDENTS</div>
        <div class="stat-value">${stats.totalStudents}</div>
        <div class="stat-foot">Student accounts</div>
      </div>

      <div class="stat-card">
        <div class="stat-top">BLUEBOOKS SOLD</div>
        <div class="stat-value">${stats.totalBluebooksSold}</div>
        <div class="stat-foot">Units physically claimed</div>
      </div>

      <div class="stat-card">
        <div class="stat-top">RESERVATIONS</div>
        <div class="stat-value">${stats.totalReservations}</div>
        <div class="stat-foot">
          Active and completed reservations
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-top">TOTAL REVENUE</div>
        <div class="stat-value">${money(stats.totalRevenue)}</div>
        <div class="stat-foot">Verified and physically claimed orders</div>
      </div>

      <div class="stat-card">
        <div class="stat-top">PENDING PAYMENTS</div>
        <div class="stat-value">${stats.pendingPayments}</div>
        <div class="stat-foot">
          Awaiting payment verification
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-top">AVAILABLE STOCK</div>
        <div class="stat-value">${stats.availableStock}</div>
        <div class="stat-foot">
          Units available for reservation or purchase
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-top">THIS WEEK'S SALES</div>
        <div class="stat-value">${money(weeklySales.revenue)}</div>
        <div class="stat-foot">
          ${weeklySales.quantity} books · ${weeklySales.orders} claimed orders
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-top">THIS MONTH'S SALES</div>
        <div class="stat-value">${money(monthlySales.revenue)}</div>
        <div class="stat-foot">
          ${monthlySales.quantity} books · ${monthlySales.orders} claimed orders
        </div>
      </div>

    </div>

    <div class="section-row">
      <h3>Recent transactions</h3>
      <button class="text-link" data-go="manageOrders">
        View all →
      </button>
    </div>

    ${ordersTable(state.orders.slice(0, 8), true)}

    <div class="section-row">
      <h3>Inventory snapshot</h3>
      <button class="text-link" data-go="inventory">
        Manage inventory →
      </button>
    </div>

    ${inventoryTable()}
  `;
}

function cashierDashboard() {
  const dashboard = state.cashierDashboard || {
    sales: { revenue: 0, quantity: 0, orders: 0 },
    history: []
  };
  const onlinePayments = state.orders.filter(order =>
    order.status === 'PENDING_PAYMENT' &&
    isOnlinePaymentMethod(order.paymentMethod) &&
    order.paymentStatus === 'PENDING'
  );
  const counterPayments = state.orders.filter(order =>
    order.status === 'RESERVED' &&
    order.paymentMethod === 'CASH' &&
    (!order.expiresAt || new Date(order.expiresAt).getTime() > Date.now())
  );
  const readyForHandover = state.orders.filter(order =>
    order.status === 'PAID' &&
    order.paymentStatus === 'VERIFIED'
  );

  return `
    <div class="page-heading">
      <div>
        <span class="eyebrow eyebrow-blue">CASHIER WORKSPACE</span>
        <h1>Payment desk</h1>
        <p>Review online payment receipts, record counter payments, and verify Bluebook handovers.</p>
      </div>
    </div>

    <div class="stats-grid cashier-stats">
      <div class="stat-card">
        <div class="stat-top">ONLINE PAYMENTS TO VERIFY</div>
        <div class="stat-value">${onlinePayments.length}</div>
        <div class="stat-foot">GCash and Maya receipts submitted</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">COUNTER PAYMENTS DUE</div>
        <div class="stat-value">${counterPayments.length}</div>
        <div class="stat-foot">Active reservations awaiting cash payment</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">ORDERS READY FOR HANDOVER</div>
        <div class="stat-value">${readyForHandover.length}</div>
        <div class="stat-foot">Paid orders awaiting claim verification</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">MY SALES TO DATE</div>
        <div class="stat-value">${money(dashboard.sales.revenue)}</div>
        <div class="stat-foot">Revenue from Bluebooks you handed over</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">BLUEBOOKS SOLD BY ME</div>
        <div class="stat-value">${dashboard.sales.quantity}</div>
        <div class="stat-foot">Bluebook unit${dashboard.sales.quantity === 1 ? '' : 's'} you handed over</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">MY COMPLETED HANDOVERS</div>
        <div class="stat-value">${dashboard.sales.orders}</div>
        <div class="stat-foot">Orders you marked as claimed</div>
      </div>
    </div>

    ${claimReceiptScanner()}

    <section class="panel cashier-queue">
      <div class="panel-title">
        <div>
          <h3>Current inventory</h3>
          <p>Shared Bluebook stock, refreshed automatically every 30 seconds.</p>
        </div>
        <button class="btn btn-light btn-small" data-refresh-cashier-dashboard>Refresh</button>
      </div>
      ${cashierInventoryTable()}
    </section>

    <section class="panel cashier-queue">
      <div class="panel-title">
        <div>
          <h3>Online payments</h3>
          <p>Verify the submitted receipt only after confirming funds were received.</p>
        </div>
      </div>
      ${ordersTable(onlinePayments, true)}
    </section>

    <section class="panel cashier-queue">
      <div class="panel-title">
        <div>
          <h3>Counter payments</h3>
          <p>Record payment only after receiving cash at the counter.</p>
        </div>
      </div>
      ${ordersTable(counterPayments, true)}
    </section>

    <section class="panel cashier-queue">
      <div class="panel-title">
        <div>
          <h3>Verify order handover</h3>
          <p>Confirm only when the Bluebook is physically released to the student.</p>
        </div>
      </div>
      ${ordersTable(readyForHandover, true)}
    </section>

    <section class="panel cashier-queue">
      <div class="panel-title">
        <div>
          <h3>My activity history</h3>
          <p>Your recent payment decisions and Bluebook handovers (up to 100 actions).</p>
        </div>
      </div>
      ${cashierHistoryTable(dashboard.history)}
    </section>
    <p class="muted cashier-refresh-note">Stock, queues, sales, and history refresh automatically every 30 seconds.</p>
  `;
}

function cashierInventoryTable() {
  if (!state.products.length) {
    return '<div class="empty-state">No Bluebook inventory is currently available.</div>';
  }

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Product</th><th>SKU</th><th>Price</th><th>On hand</th><th>Reserved</th><th>Available</th></tr>
        </thead>
        <tbody>
          ${state.products.map(product => `
            <tr>
              <td><strong>${escapeHtml(product.name)}</strong></td>
              <td>${escapeHtml(product.sku)}</td>
              <td>${money(product.price)}</td>
              <td>${product.onHand}</td>
              <td>${product.reserved || 0}</td>
              <td>${product.stock}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function cashierHistoryTable(history) {
  if (!history.length) {
    return '<div class="empty-state">Your payment and handover actions will appear here.</div>';
  }

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Activity</th><th>Order</th><th>Student</th><th>Qty</th><th>Amount</th><th>Result</th><th>Date</th></tr>
        </thead>
        <tbody>
          ${history.map(activity => `
            <tr>
              <td>
                <strong>${escapeHtml(activity.action)}</strong>
                <small class="muted" style="display:block;margin-top:4px">${paymentMethodLabel(activity.paymentMethod)}</small>
              </td>
              <td>${escapeHtml(activity.reference)}</td>
              <td>${escapeHtml(activity.studentName)}</td>
              <td>${activity.quantity ?? '—'}</td>
              <td>${money(activity.amount)}</td>
              <td><span class="status ${statusClass(activity.status)}">${prettyStatus(activity.status)}</span></td>
              <td>${activity.occurredAt ? new Date(activity.occurredAt).toLocaleString() : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function reportRecordsTable(title, records, kind) {
  if (!records.length) {
    return `
      <section class="panel report-panel">
        <div class="panel-title"><div><h3>${title}</h3></div></div>
        <div class="empty-state">No ${title.toLowerCase()} in this period.</div>
      </section>
    `;
  }

  const dateField = kind === 'cancellations'
    ? 'cancelledAt'
    : kind === 'sales' || kind === 'claims'
      ? 'claimedAt'
      : 'createdAt';
  const columns = kind === 'cancellations'
    ? ['Cancelled at', 'Cancelled by', 'Order reference', 'Student', 'Qty', 'Total', 'Reason / refund']
    : kind === 'sales'
      ? ['Claimed at', 'Handover cashier', 'Order reference', 'Student', 'Qty', 'Payment', 'Total']
      : kind === 'claims'
        ? ['Claimed at', 'Handover cashier', 'Order reference', 'Student', 'Qty', 'Total']
        : ['Created', 'Cashier #', 'Order reference', 'Student', 'Type', 'Status', 'Qty', 'Total'];

  return `
    <section class="panel report-panel">
      <div class="panel-title">
        <div>
          <h3>${title}</h3>
          <p>Showing up to 100 records for the selected period.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>${columns.map(column => `<th>${column}</th>`).join('')}</tr></thead>
          <tbody>
            ${records.map(record => `
              <tr>
                <td>${record[dateField] ? new Date(record[dateField]).toLocaleString() : '—'}</td>
                <td>${escapeHtml(
                  kind === 'cancellations'
                    ? record.cancelledBy || 'Admin'
                    : kind === 'sales' || kind === 'claims'
                      ? record.handoverBy || '—'
                      : record.verifiedBy || '—'
                )}</td>
                <td><strong>${escapeHtml(record.reference)}</strong></td>
                <td>${escapeHtml(record.studentName || '—')}</td>
                ${kind === 'orders' ? `
                  <td>${record.type === 'PURCHASE' ? 'Online purchase' : 'Reservation'}</td>
                  <td><span class="status ${statusClass(record.status)}">${prettyStatus(record.status)}</span></td>
                ` : ''}
                <td>${record.quantity}</td>
                ${kind === 'sales' ? `<td>${paymentMethodLabel(record.paymentMethod)}</td>` : ''}
                <td>${money(record.total)}</td>
                ${kind === 'cancellations' ? `
                  <td>
                    ${escapeHtml(record.cancellationReason || '—')}
                    ${record.manualRefundRequired ? '<small class="muted" style="display:block;margin-top:5px">Manual refund required</small>' : ''}
                  </td>
                ` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function cashierSalesTable(records) {
  if (!records.length) {
    return `
      <section class="panel report-panel cashier-sales-panel">
        <div class="panel-title"><div><h3>Per cashiers sales</h3></div></div>
        <div class="empty-state">No cashier accounts are available.</div>
      </section>
    `;
  }

  return `
    <section class="panel report-panel cashier-sales-panel">
      <div class="panel-title">
        <div>
          <h3>Per cashiers sales</h3>
          <p>Sales are attributed to the cashier who confirmed the handover.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Cashier</th><th>Total Bluebooks sold</th><th>Total sales</th></tr>
          </thead>
          <tbody>
            ${records.map(record => `
              <tr>
                <td><strong>${escapeHtml(record.cashierName)}</strong></td>
                <td>${record.quantity}</td>
                <td>${money(record.revenue)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function adminReportContent() {
  if (state.reportLoading) {
    return '<div class="panel"><p class="muted">Loading report…</p></div>';
  }
  if (state.reportError) {
    return `<div class="notice" role="alert">${escapeHtml(state.reportError)}</div>`;
  }
  if (!state.adminReport) {
    return '<div class="panel"><p class="muted">Choose a period to view its report.</p></div>';
  }

  const report = state.adminReport;
  const start = new Date(report.range.start).toLocaleDateString();
  const end = new Date(report.range.end).toLocaleDateString();

  return `
    <div class="report-range">
      ${escapeHtml(report.range.label)} · ${start}${start === end ? '' : ` – ${end}`}
    </div>
    <div class="report-summary-grid">
      <article class="report-metric-card">
        <span class="report-metric-label">Sales</span>
        <strong class="report-metric-value">${money(report.sales.revenue)}</strong>
        <span class="report-metric-detail">${report.sales.orders} verified &amp; claimed orders · ${report.sales.quantity} Bluebooks sold</span>
      </article>
      <article class="report-metric-card">
        <span class="report-metric-label">Orders</span>
        <strong class="report-metric-value">${report.orders.total}</strong>
        <span class="report-metric-detail">${report.orders.pending} pending · ${report.orders.paid} paid · ${report.orders.expired} expired · ${report.orders.cancelled} cancelled</span>
      </article>
      <article class="report-metric-card">
        <span class="report-metric-label">Claims</span>
        <strong class="report-metric-value">${report.claims.count}</strong>
        <span class="report-metric-detail">${report.claims.quantity} Bluebooks claimed · ${money(report.claims.amount)} value</span>
      </article>
      <article class="report-metric-card">
        <span class="report-metric-label">Cancellations</span>
        <strong class="report-metric-value">${report.cancellations.count}</strong>
        <span class="report-metric-detail">${report.cancellations.quantity} Bluebooks · ${money(report.cancellations.amount)} order value · ${report.cancellations.manualRefunds} manual refunds required</span>
      </article>
    </div>
    <div class="report-records-grid">
      ${reportRecordsTable('Sales records', report.sales.records, 'sales')}
      ${reportRecordsTable('Orders created', report.orders.records, 'orders')}
      ${reportRecordsTable('Bluebook claims', report.claims.records, 'claims')}
      ${cashierSalesTable(report.cashierSales)}
      ${reportRecordsTable('Cancelled orders', report.cancellations.records, 'cancellations')}
    </div>
  `;
}

function reportsPage() {
  return `
    <div class="page-heading">
      <div>
        <span class="eyebrow eyebrow-blue">ADMINISTRATION</span>
        <h1>Sales, orders &amp; claims reports</h1>
        <p>Review sales, orders, physical claims, and cancellations recorded during the selected period.</p>
      </div>
    </div>

    <div class="report-toolbar">
      <label for="reportPeriodFilter">Report period</label>
      <select id="reportPeriodFilter" class="select-filter">
        <option value="daily" ${state.reportPeriod === 'daily' ? 'selected' : ''}>Daily</option>
        <option value="weekly" ${state.reportPeriod === 'weekly' ? 'selected' : ''}>Weekly</option>
        <option value="monthly" ${state.reportPeriod === 'monthly' ? 'selected' : ''}>Monthly</option>
        <option value="quarterly" ${state.reportPeriod === 'quarterly' ? 'selected' : ''}>Quarterly</option>
        <option value="annually" ${state.reportPeriod === 'annually' ? 'selected' : ''}>Annually</option>
      </select>
      <button class="btn btn-light btn-small" data-report-refresh>Refresh report</button>
      <span class="muted">Dates use Philippine time (UTC+8); weeks start Monday.</span>
    </div>

    <div id="adminReportContent">${adminReportContent()}</div>
  `;
}

async function loadAdminReport(period) {
  state.reportPeriod = period;
  state.adminReport = null;
  state.reportError = '';
  state.reportLoading = true;
  renderPage('reports');

  try {
    const data = await api(`/api/admin/reports?period=${encodeURIComponent(period)}`);
    if (state.page !== 'reports' || state.reportPeriod !== period) return;
    state.adminReport = data.report;
    state.reportLoading = false;
    renderPage('reports');
  } catch (error) {
    if (state.page !== 'reports' || state.reportPeriod !== period) return;
    state.reportError = error.message;
    state.reportLoading = false;
    renderPage('reports');
  }
}

function inventoryPage() {
  return `
    <div class="page-heading">
      <div>
        <span class="eyebrow eyebrow-blue">STOCK CONTROL</span>
        <h1>Inventory management</h1>
        <p>Monitor Bluebook quantities, update available stock, and change the price for future orders.</p>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">
        <div>
          <h3>Bluebook inventory</h3>
          <p>Stock is stored in the connected MongoDB database.</p>
        </div>
      </div>

      ${inventoryTable()}
    </div>

    <div class="panel" style="margin-top:18px">
      <div class="panel-title">
        <div>
          <h3>Counter payment expiration</h3>
          <p>Set how long new counter reservations remain payable.</p>
        </div>
      </div>
      <div style="padding:0 20px 20px">
        <strong>${escapeHtml(String(state.counterExpirationHours))} hours</strong>
        <p class="muted">Existing reservations keep their original deadline.</p>
        <button class="btn btn-light btn-small" type="button" data-edit-counter-expiration>
          Update expiration time
        </button>
      </div>
    </div>
  `;
}

function manageOrdersPage() {
  return `
    <div class="page-heading">
      <div>
        <span class="eyebrow eyebrow-blue">
          TRANSACTION MANAGEMENT
        </span>

        <h1>Orders & claims</h1>

        <p>
          Review student reservations and purchases,
          then record payment and product release.
        </p>
      </div>
    </div>

    ${claimReceiptScanner()}

    <div class="toolbar">
      <div class="search-box">
        <span>⌕</span>
        <input
          id="orderSearch"
          placeholder="Search order reference or student..."
        >
      </div>

      <select id="orderStatusFilter" class="select-filter">
        <option value="all">All statuses</option>
        <option value="RESERVED">Reserved</option>
        <option value="PENDING_PAYMENT">Pending payment</option>
        <option value="PAID">Paid</option>
        <option value="CLAIMED">Claimed</option>
        <option value="CANCELLED">Cancelled</option>
        <option value="EXPIRED">Expired</option>
      </select>
    </div>

    <div id="adminOrdersTable">
      ${ordersTable(state.orders, true)}
    </div>
  `;
}

function manageStudentsPage() {
  return `
    <div class="page-heading">
      <div>
        <span class="eyebrow eyebrow-blue">${state.user?.role === 'cashier' ? 'CASHIER WORKSPACE' : 'ADMINISTRATION'}</span>
        <h1>Student lookup</h1>
        <p>Search student accounts by name or student ID. This view does not edit account details.</p>
      </div>
    </div>

    <div class="toolbar">
      <div class="search-box">
        <span>⌕</span>
        <input id="studentSearch" type="search" autocomplete="off" placeholder="Enter a name or student ID">
      </div>
    </div>

    <div id="studentSearchResults" class="panel">
      <p class="muted">Enter at least two characters to search.</p>
    </div>
  `;
}

function studentResultsTable(students) {
  if (!students.length) {
    return '<div class="empty-state">No matching student accounts found.</div>';
  }

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Student ID</th>
            <th>Email</th>
            <th>Account</th>
            <th>Orders</th>
          </tr>
        </thead>
        <tbody>
          ${students.map(student => `
            <tr>
              <td><strong>${escapeHtml(student.name)}</strong></td>
              <td>${escapeHtml(student.studentId)}</td>
              <td>${escapeHtml(student.email)}</td>
              <td>${student.active ? 'Active' : 'Inactive'}</td>
              <td>${student.totalOrders}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function searchStudents(query) {
  const target = $('#studentSearchResults');
  const term = query.trim();
  if (!target) return;
  if (term.length < 2) {
    target.innerHTML = '<p class="muted">Enter at least two characters to search.</p>';
    return;
  }

  target.innerHTML = '<p class="muted">Searching student accounts…</p>';
  try {
    const data = await api(`/api/admin/students?q=${encodeURIComponent(term)}`);
    if ($('#studentSearch')?.value.trim() !== term) return;
    target.innerHTML = studentResultsTable(data.students || []);
  } catch (error) {
    target.innerHTML = `<p class="notice">${escapeHtml(error.message)}</p>`;
  }
}

function renderPage(page) {
  const renderers = {
    dashboard: studentDashboard,
    catalog: catalogPage,
    orders: ordersPage,
    adminDashboard,
    cashierDashboard,
    inventory: inventoryPage,
    manageOrders: manageOrdersPage,
    reports: reportsPage,
    manageStudents: manageStudentsPage
  };

  const target = $(`#page-${page}`);

  if (target && renderers[page]) {
    target.innerHTML = renderers[page]();
  }
}

function openOrderModal(productId) {
  const p = state.products.find(x => x.id === productId);

  if (!p || p.stock <= 0) {
    return toast('This Bluebook is currently unavailable.');
  }

  $('#modalRoot').innerHTML = `
    <div class="modal-backdrop" data-backdrop>
      <div class="modal" style="max-height:calc(100vh - 36px);overflow:auto">

        <div class="modal-head">
          <div>
            <h3>Order Bluebook</h3>
            <p>Step 1 of 3 · Choose quantity and payment method.</p>
          </div>

          <button class="modal-close" data-close-modal>×</button>
        </div>

        <form id="orderForm" class="modal-form">

          <label>
            Product
            <input value="${escapeHtml(p.name)}" disabled>
          </label>

          <label>
            Quantity
            <input
              id="orderQuantity"
              type="number"
              min="1"
              max="${Math.min(20, p.stock)}"
              value="1"
              required
            >
          </label>

          <div class="order-summary">
            <span>Step 1</span>
            <strong>Choose quantity &amp; payment</strong>
          </div>

          <label>
            Transaction type
            <select id="orderType">
              <option value="RESERVATION">
                Reserve Bluebook
              </option>

              <option value="PURCHASE">
                Buy online — GCash or Maya
              </option>
            </select>
          </label>

          <label>
            Payment method
            <select id="orderPaymentMethod">
              <option value="CASH">Pay at Bluebook Payment Counter</option>
              <option value="GCASH">Pay online with GCash</option>
              <option value="MAYA">Pay online with Maya</option>
            </select>
          </label>

          <p id="paymentMethodHelp" class="muted" style="font-size:11px;line-height:1.5;margin:0">
            Counter reservations are held for 8 hours. Payment is recorded by the cashier.
          </p>

          <div class="order-summary">
            <span>Estimated total</span>
            <strong id="orderTotal">${money(p.price)}</strong>
          </div>

          <button
            class="btn btn-primary btn-full"
            type="submit"
          >
            Create order <span>→</span>
          </button>

        </form>
      </div>
    </div>
  `;

  $('#orderQuantity').addEventListener('input', () => {
    const quantity = Math.max(
      0,
      Number($('#orderQuantity').value)
    );

    $('#orderTotal').textContent = money(quantity * p.price);
  });

  const updatePaymentOptions = () => {
    const purchase = $('#orderType').value === 'PURCHASE';
    const counterOption = $('#orderPaymentMethod').querySelector('[value="CASH"]');
    counterOption.hidden = purchase;
    if (purchase && $('#orderPaymentMethod').value === 'CASH') {
      $('#orderPaymentMethod').value = 'GCASH';
    }
    const method = $('#orderPaymentMethod').value;
    const wallet = paymentMethodLabel(method);
    $('#paymentMethodHelp').textContent = purchase
      ? `Scan the ${wallet} QR, pay the amount due, then upload your receipt. Stock is deducted only after staff verification.`
      : isOnlinePaymentMethod(method)
        ? `Scan the ${wallet} QR and upload your receipt. The reservation is held for 24 hours while staff reviews payment.`
        : 'Counter reservations are held for 8 hours. Pay at the Bluebook Payment Counter before expiry.';
  };

  $('#orderType').addEventListener('change', updatePaymentOptions);
  $('#orderPaymentMethod').addEventListener('change', updatePaymentOptions);
  updatePaymentOptions();

  $('#orderForm').addEventListener('submit', async e => {
    e.preventDefault();

    const button = e.currentTarget.querySelector(
      'button[type="submit"]'
    );

    button.disabled = true;

    try {
      const result = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          productId: p.id,
          quantity: Number($('#orderQuantity').value),
          type: $('#orderType').value,
          paymentMethod: $('#orderPaymentMethod').value
        })
      });

      $('#modalRoot').innerHTML = '';

      await refreshData();
      renderPage(state.page);

      toast('Order successfully created.');

      await showPaymentStep(result.order);

    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  });
}
async function showPaymentStep(order) {
  let counterQrMarkup = '';
  if (order.paymentMethod === 'CASH') {
    const qr = await api(`/api/orders/${order.id}/qr`);
    counterQrMarkup = `
      <img src="${qr.qr}" alt="Counter payment reference QR code"
        style="display:block;width:190px;height:190px;margin:16px auto">
      <div class="order-summary">
        <span>Counter reference</span><strong>${escapeHtml(order.ref)}</strong>
      </div>
      <p class="muted" style="text-align:center">
        Show this QR to the cashier to find your reservation and record your cash payment.
        This QR does not mean the order is paid.
      </p>
      <button class="btn btn-light btn-full" data-download-reference="${order.id}">
        Download counter reference PDF
      </button>
    `;
  }

  $('#modalRoot').innerHTML = `
    <div class="modal-backdrop" data-backdrop>
      <div class="modal" style="max-height:calc(100vh - 36px);overflow:auto">
        <div class="modal-head">
          <div>
            <h3>Step 2 of 3 · Complete payment</h3>
            <p>Order ${escapeHtml(order.ref)}</p>
          </div>

          <button class="modal-close" data-close-modal>×</button>
        </div>

        <div class="order-summary">
          <span>Order reference</span>
          <strong>${escapeHtml(order.ref)}</strong>
        </div>

        <div class="order-summary">
          <span>Step 1 · Bluebooks</span>
          <strong>${escapeHtml(order.productName)} × ${order.quantity}</strong>
        </div>
        <div class="order-summary">
          <span>Step 2 · Amount due</span><strong>${money(order.total)}</strong>
        </div>

        ${isOnlinePaymentMethod(order.paymentMethod)
          ? `${paymentQrMarkup(order.paymentMethod)}
            <div class="notice" role="note">
              Scan this ${paymentMethodLabel(order.paymentMethod)} QR, confirm the recipient details, and pay the amount due.
              After payment, upload your receipt for staff verification. No claim receipt is issued until payment is confirmed.
            </div>
            <button class="btn btn-primary btn-full" data-upload-payment="${order.id}">
              I paid - upload ${paymentMethodLabel(order.paymentMethod)} receipt
            </button>`
          : `<div class="notice" role="note">
              Pay at the <strong>Bluebook Payment Counter</strong> within 8 hours.
              Your reservation expires at <strong>${new Date(order.expiresAt).toLocaleString()}</strong>.
              The cashier will record payment before your claim receipt is issued.
            </div>
            ${counterQrMarkup}`}

        <button class="btn btn-light btn-full" data-close-modal>Done</button>

      </div>
    </div>
  `;
}

async function showCounterPaymentQr(orderId) {
  const order = state.orders.find(item => item.id === orderId);
  if (!order) return toast('Counter reservation was not found. Refresh your orders.');

  try {
    const qr = await api(`/api/orders/${orderId}/qr`);
    $('#modalRoot').innerHTML = `
      <div class="modal-backdrop" data-backdrop>
        <div class="modal">
          <div class="modal-head">
            <div>
              <h3>Counter payment reference</h3>
              <p>${escapeHtml(order.ref)}</p>
            </div>
            <button class="modal-close" data-close-modal>×</button>
          </div>
          <img src="${qr.qr}" alt="Counter payment reference QR code"
            style="display:block;width:210px;height:210px;margin:16px auto">
          <div class="order-summary">
            <span>Bluebooks</span><strong>${escapeHtml(order.productName)} × ${order.quantity}</strong>
          </div>
          <div class="order-summary">
            <span>Amount due</span><strong>${money(order.total)}</strong>
          </div>
          <div class="notice" role="note">
            Show this QR or reference to the cashier to find your reservation and record your cash payment.
            It is not proof of payment. Pay by <strong>${new Date(order.expiresAt).toLocaleString()}</strong>.
          </div>
          <button class="btn btn-primary btn-full" data-download-reference="${order.id}">
            Download counter reference PDF
          </button>
        </div>
      </div>
    `;
  } catch (error) {
    toast(error.message);
  }
}

function showPaymentPending(order) {
  $('#modalRoot').innerHTML = `
    <div class="modal-backdrop" data-backdrop>
      <div class="modal">
        <div class="modal-head">
          <div>
            <h3>Step 2 of 3 · Payment submitted</h3>
            <p>Order ${escapeHtml(order.ref)}</p>
          </div>
          <button class="modal-close" data-close-modal>×</button>
        </div>
        <div class="notice" role="status">
          Your ${paymentMethodLabel(order.paymentMethod)} receipt is awaiting staff verification. The claim receipt will be available
          after payment is confirmed. This order expires at
          <strong>${new Date(order.expiresAt).toLocaleString()}</strong>.
        </div>
        <button class="btn btn-primary btn-full" data-close-modal>Done</button>
      </div>
    </div>
  `;
}

function enableModalDragging(modal) {
  const handle = $('.modal-drag-handle', modal);
  if (!handle) return;

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;

    const bounds = modal.getBoundingClientRect();
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    originLeft = bounds.left;
    originTop = bounds.top;

    modal.style.position = 'fixed';
    modal.style.width = `${bounds.width}px`;
    modal.style.maxWidth = 'calc(100vw - 36px)';
    modal.style.margin = '0';
    modal.style.left = `${bounds.left}px`;
    modal.style.top = `${bounds.top}px`;
    handle.style.cursor = 'grabbing';
    handle.setPointerCapture(pointerId);
    event.preventDefault();
  });

  handle.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId) return;

    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - modal.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - modal.offsetHeight - margin);
    const left = Math.min(maxLeft, Math.max(margin, originLeft + event.clientX - startX));
    const top = Math.min(maxTop, Math.max(margin, originTop + event.clientY - startY));
    modal.style.left = `${left}px`;
    modal.style.top = `${top}px`;
  });

  const stopDragging = event => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    handle.style.cursor = 'grab';
  };
  handle.addEventListener('pointerup', stopDragging);
  handle.addEventListener('pointercancel', stopDragging);
  handle.addEventListener('lostpointercapture', stopDragging);
}

function openPaymentUpload(orderId) {
  const order = state.orders.find(item => item.id === orderId);
  const wallet = order ? paymentMethodLabel(order.paymentMethod) : 'online wallet';
  $('#modalRoot').innerHTML = `
    <div class="modal-backdrop" data-backdrop>
      <div class="modal" style="max-height:calc(100vh - 36px);overflow:auto">
        <div class="modal-head modal-drag-handle" title="Drag to move">
          <div>
            <h3>Submit ${wallet} receipt</h3>
            <p>Payment proof is reviewed by authorized staff.</p>
          </div>
          <button class="modal-close" data-close-modal>×</button>
        </div>

        <div class="notice" role="note">
          Scan the QR below and pay the amount due if you have not already paid. Verify the recipient before transferring.
          Upload the transaction receipt; staff must verify it before the order is marked paid. Never share your wallet PIN or one-time code.
        </div>
        ${order ? `
          <div class="order-summary">
            <span>Amount due</span><strong>${money(order.total)}</strong>
          </div>
          ${paymentQrMarkup(order.paymentMethod)}
        ` : ''}

        <form id="paymentProofForm" class="modal-form">
          <input type="hidden" name="orderId" value="${escapeHtml(orderId)}">
          <label>
            ${wallet} receipt image
            <input id="paymentProofFile" name="proof" type="file"
              accept="image/jpeg,image/png,image/webp" required>
          </label>
          <p class="muted" style="font-size:11px">JPEG, PNG, or WebP; maximum 4 MB on Vercel and 5 MB locally.</p>
          <img id="paymentProofPreview" class="hidden" alt="${wallet} receipt preview"
            style="max-width:100%;max-height:300px;object-fit:contain">
          <button class="btn btn-primary btn-full" type="submit">Submit for verification</button>
        </form>
      </div>
    </div>
  `;

  enableModalDragging($('#modalRoot .modal'));

  $('#paymentProofFile').addEventListener('change', event => {
    const file = event.target.files[0];
    const preview = $('#paymentProofPreview');
    if (state.paymentPreviewUrl) URL.revokeObjectURL(state.paymentPreviewUrl);
    state.paymentPreviewUrl = '';
    preview.classList.add('hidden');
    preview.removeAttribute('src');
    if (file && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      state.paymentPreviewUrl = URL.createObjectURL(file);
      preview.src = state.paymentPreviewUrl;
      preview.classList.remove('hidden');
    }
  });

  $('#paymentProofForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(form, true);
    try {
      const result = await api('/api/payments/online', {
        method: 'POST',
        body: new FormData(form)
      });
      if (state.paymentPreviewUrl) URL.revokeObjectURL(state.paymentPreviewUrl);
      state.paymentPreviewUrl = '';
      $('#modalRoot').innerHTML = '';
      await refreshData();
      renderPage(state.page);
      const order = state.orders.find(item => item.id === orderId);
      if (order) showPaymentPending(order);
      toast(result.message);
    } catch (error) {
      toast(error.message);
      setBusy(form, false);
    }
  });
}

function updateStock(productId) {
  const p = state.products.find(x => x.id === productId);

  if (!p) return;

  $('#modalRoot').innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">

        <div class="modal-head">
          <div>
            <h3>Update inventory</h3>
            <p>${escapeHtml(p.name)}</p>
          </div>

          <button class="modal-close" data-close-modal>×</button>
        </div>

        <form id="stockForm" class="modal-form">

          <label>
            New total on-hand quantity
            <input
              id="newStock"
              type="number"
              min="${p.reserved || 0}"
              value="${p.onHand}"
              required
            >
          </label>

          <p style="font-size:11px;color:#8794a3">
            Cannot set stock below
            ${p.reserved || 0}
            units already reserved.
          </p>

          <button class="btn btn-primary btn-full">
            Save inventory
          </button>

        </form>
      </div>
    </div>
  `;

  $('#stockForm').addEventListener('submit', async e => {
    e.preventDefault();

    try {
      await api(`/api/products/${productId}/stock`, {
        method: 'PATCH',
        body: JSON.stringify({
          stock: Number($('#newStock').value)
        })
      });

      $('#modalRoot').innerHTML = '';

      await refreshData();
      renderPage(state.page);

      toast('Inventory updated in MongoDB.');

    } catch (error) {
      toast(error.message);
    }
  });
}

function updateCounterExpiration() {
  $('#modalRoot').innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-head">
          <div>
            <h3>Update counter payment expiration</h3>
            <p>New counter reservations only</p>
          </div>
          <button class="modal-close" data-close-modal>×</button>
        </div>
        <form id="counterExpirationForm" class="modal-form">
          <label>
            Payment deadline (hours)
            <input
              id="counterExpirationHours"
              type="number"
              min="1"
              max="168"
              step="1"
              value="${Number(state.counterExpirationHours)}"
              required
            >
          </label>
          <p class="muted">Existing counter reservations keep their current payment deadline.</p>
          <button class="btn btn-primary btn-full" type="submit">Save expiration time</button>
        </form>
      </div>
    </div>
  `;

  $('#counterExpirationForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submitButton = $('#counterExpirationForm button[type="submit"]');
    submitButton.disabled = true;
    try {
      const result = await api('/api/admin/settings/counter-expiration', {
        method: 'PATCH',
        body: JSON.stringify({
          counterExpirationHours: Number($('#counterExpirationHours').value)
        })
      });
      state.counterExpirationHours = Number(result.counterExpirationHours);
      $('#modalRoot').innerHTML = '';
      renderPage(state.page);
      toast(result.message);
    } catch (error) {
      submitButton.disabled = false;
      toast(error.message);
    }
  });
}

function updatePrice(productId) {
  const product = state.products.find(item => item.id === productId);
  if (!product) return;

  $('#modalRoot').innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-head">
          <div>
            <h3>Update Bluebook price</h3>
            <p>${escapeHtml(product.name)}</p>
          </div>
          <button class="modal-close" data-close-modal>×</button>
        </div>
        <form id="priceForm" class="modal-form">
          <label>
            New price per Bluebook
            <input id="newPrice" type="number" min="0" step="0.01"
              value="${Number(product.price).toFixed(2)}" required>
          </label>
          <p class="muted">The new price applies to future orders. Existing orders keep their recorded price.</p>
          <button class="btn btn-primary btn-full" type="submit">Save price</button>
        </form>
      </div>
    </div>
  `;

  $('#priceForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submitButton = $('#priceForm button[type="submit"]');
    submitButton.disabled = true;
    try {
      await api(`/api/products/${encodeURIComponent(productId)}/price`, {
        method: 'PATCH',
        body: JSON.stringify({ price: Number($('#newPrice').value) })
      });
      $('#modalRoot').innerHTML = '';
      await refreshData();
      renderPage(state.page);
      toast('Bluebook price updated.');
    } catch (error) {
      submitButton.disabled = false;
      toast(error.message);
    }
  });
}

async function recordCounterPayment(orderId) {
  if (!confirm(
    'Confirm that the student paid at the Bluebook Payment Counter?'
  )) {
    return;
  }

  try {
    await api('/api/payments/counter', {
      method: 'POST',
      body: JSON.stringify({ orderId })
    });

    await refreshData();
    renderPage(state.page);

    toast(
      'Counter payment recorded. Stock will be deducted when the Bluebook is claimed.'
    );

  } catch (error) {
    toast(error.message);
  }
}

async function reviewPayment(paymentId) {
  const payment = state.payments.find(item => item.id === paymentId);
  if (!payment || !payment.proofAvailable) {
    return toast('Payment receipt image is unavailable.');
  }
  const hasOrderContext = Boolean(
    payment.orderReference &&
    payment.orderProductName &&
    Number.isInteger(payment.orderQuantity) &&
    payment.orderTotal !== null
  );

  try {
    const response = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/proof`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Receipt could not be loaded (${response.status}).`);
    }

    if (state.paymentPreviewUrl) URL.revokeObjectURL(state.paymentPreviewUrl);
    state.paymentPreviewUrl = URL.createObjectURL(await response.blob());
    $('#modalRoot').innerHTML = `
      <div class="modal-backdrop" data-backdrop>
        <div class="modal" style="max-height:calc(100vh - 36px);overflow:auto">
          <div class="modal-head">
            <div>
              <h3>Review ${paymentMethodLabel(payment.method)} receipt</h3>
              <p>${escapeHtml(payment.studentName || 'Student')} · Order ${escapeHtml(payment.orderReference || 'details unavailable')}</p>
            </div>
            <button class="modal-close" data-close-modal>×</button>
          </div>
          <div class="order-summary">
            <span>Bluebook order</span>
            <strong>${escapeHtml(payment.orderProductName || 'Order details unavailable')}${Number.isInteger(payment.orderQuantity) ? ` × ${payment.orderQuantity}` : ''}</strong>
          </div>
          <div class="order-summary">
            <span>Order total</span>
            <strong>${payment.orderTotal === null ? 'Unavailable' : money(payment.orderTotal)}</strong>
          </div>
          <div class="order-summary">
            <span>Submitted amount</span><strong>${money(payment.amount)}</strong>
          </div>
          <p class="muted">Internal payment ID: ${escapeHtml(payment.referenceNumber)}</p>
          <img src="${state.paymentPreviewUrl}" alt="Submitted ${paymentMethodLabel(payment.method)} receipt"
            style="display:block;max-width:100%;max-height:420px;object-fit:contain;margin:16px auto">
          <p class="muted">${escapeHtml(payment.proofName)}</p>
          ${hasOrderContext ? '' : '<p class="error-message" role="alert">Order details are unavailable. Refresh the orders list before verifying this payment.</p>'}
          <button class="btn btn-primary btn-full" data-verify-payment="${payment.id}" ${hasOrderContext ? '' : 'disabled'}>
            Verify payment and deduct stock
          </button>
          <form id="paymentRejectForm" class="modal-form">
            <label>
              Rejection reason
              <textarea id="paymentRejectReason" maxlength="500" required
                style="min-height:80px;padding:10px;border:1px solid #dce3eb;border-radius:9px"></textarea>
            </label>
            <button class="btn btn-light btn-full" type="submit">Reject receipt</button>
          </form>
        </div>
      </div>
    `;

    $('#paymentRejectForm').addEventListener('submit', async event => {
      event.preventDefault();
      const remarks = $('#paymentRejectReason').value.trim();
      try {
        await api(`/api/payments/${payment.id}/reject`, {
          method: 'PATCH',
          body: JSON.stringify({ remarks })
        });
        if (state.paymentPreviewUrl) URL.revokeObjectURL(state.paymentPreviewUrl);
        state.paymentPreviewUrl = '';
        $('#modalRoot').innerHTML = '';
        await refreshData();
        renderPage(state.page);
        toast('Receipt rejected. The student can resubmit before the reservation expires.');
      } catch (error) {
        toast(error.message);
      }
    });
  } catch (error) {
    toast(error.message);
  }
}

async function verifyPayment(paymentId) {
  if (!confirm(`Verify that this ${paymentMethodLabel(state.payments.find(payment => payment.id === paymentId)?.method)} receipt matches funds actually received by the university?`)) {
    return;
  }
  try {
    await api(`/api/payments/${paymentId}/verify`, { method: 'PATCH', body: '{}' });
    if (state.paymentPreviewUrl) URL.revokeObjectURL(state.paymentPreviewUrl);
    state.paymentPreviewUrl = '';
    $('#modalRoot').innerHTML = '';
    await refreshData();
    renderPage(state.page);
    toast('Payment verified; stock was deducted and the receipt is ready for the student.');
  } catch (error) {
    toast(error.message);
  }
}

function setCashierScannerStatus(message, isError = false) {
  const status = $('#cashierReceiptScannerStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function isClaimReceiptScannerPage() {
  return (state.user?.role === 'cashier' && state.page === 'cashierDashboard') ||
    (state.user?.role === 'admin' && state.page === 'manageOrders');
}

async function scanCashierReceipt(qrContent) {
  const content = String(qrContent || '').trim();
  if (!content) {
    setCashierScannerStatus('Scan or upload a claim receipt QR first.', true);
    return;
  }
  if (state.cashierScanBusy) return;

  state.cashierScanBusy = true;
  stopCashierReceiptCamera();
  setCashierScannerStatus('Checking receipt and recording the handover…');

  try {
    const scanEndpoint = state.user?.role === 'admin'
      ? '/api/orders/scan-claim'
      : '/api/cashier/scan-claim';
    const result = await api(scanEndpoint, {
      method: 'POST',
      body: JSON.stringify({ qrContent: content })
    });
    const receiptNumber = result.receipt?.receiptNumber || 'Receipt';
    const order = result.order;
    const summary = `${receiptNumber} verified · ${paymentMethodLabel(result.paymentMethod)} · ${order.studentName} · ${order.productName} × ${order.quantity} · ${money(order.total)}`;
    setCashierScannerStatus(summary);
    toast(result.message);
    const input = $('#cashierReceiptScanInput');
    if (input) input.value = '';

    try {
      await refreshData();
      if (isClaimReceiptScannerPage()) {
        renderPage(state.page);
        setCashierScannerStatus(summary);
      }
    } catch (error) {
      toast(`Handover recorded, but dashboard refresh failed: ${error.message}`);
    }
  } catch (error) {
    setCashierScannerStatus(`Receipt scan failed: ${error.message}`, true);
    toast(`Receipt scan failed: ${error.message}`);
  } finally {
    state.cashierScanBusy = false;
  }
}

async function decodeReceiptQrImage(file) {
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, or WebP QR image.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('The QR image must be 10 MB or smaller.');
  }
  if (!window.jsQR) {
    throw new Error('The QR image decoder did not load. Refresh the page and try again.');
  }

  const image = await createImageBitmap(file);
  try {
    if (image.width > 8000 || image.height > 8000 || image.width * image.height > 40000000) {
      throw new Error('The QR image dimensions are too large. Choose a smaller image.');
    }

    const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Unable to read the selected image.');

    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const code = window.jsQR(pixels.data, width, height, {
      inversionAttempts: 'attemptBoth'
    });
    if (!code?.data) {
      throw new Error('No readable QR code was found. Choose a clearer image of the receipt QR.');
    }
    return code.data;
  } finally {
    image.close();
  }
}

async function handleReceiptQrUpload(file) {
  if (!file || state.cashierImageScanBusy) return;
  state.cashierImageScanBusy = true;
  setCashierScannerStatus('Reading the QR image on this device…');

  try {
    const content = await decodeReceiptQrImage(file);
    if (content.length > 128) {
      throw new Error('The QR content is too long to be a BlueBook claim receipt.');
    }
    const input = $('#cashierReceiptScanInput');
    if (!input) return;
    input.value = content;
    setCashierScannerStatus('QR decoded. Confirm the physical handover, then select Verify and claim.');
  } catch (error) {
    setCashierScannerStatus(error.message, true);
    toast(`QR image could not be read: ${error.message}`);
  } finally {
    state.cashierImageScanBusy = false;
  }
}

async function startCashierReceiptCamera() {
  if (state.cashierScannerStream) {
    stopCashierReceiptCamera();
    setCashierScannerStatus('Camera stopped. You can reopen it or use a QR image or USB scanner.');
    return;
  }
  if (!isClaimReceiptScannerPage()) return;
  if (!window.BarcodeDetector && !window.jsQR) {
    setCashierScannerStatus('QR scanning is unavailable in this browser. Refresh the page or use a USB scanner.', true);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setCashierScannerStatus('Camera access is unavailable. Open the site over HTTPS or use a QR image or USB scanner.', true);
    return;
  }

  const video = $('#cashierReceiptScannerVideo');
  if (!video) return;

  try {
    const detector = window.BarcodeDetector
      ? new window.BarcodeDetector({ formats: ['qr_code'] })
      : null;
    setCashierScannerStatus('Requesting camera permission. Allow access in your browser prompt…');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' } }
    });
    if (
      !isClaimReceiptScannerPage() ||
      !document.contains(video)
    ) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    state.cashierScannerStream = stream;
    video.srcObject = stream;
    video.classList.remove('hidden');
    await video.play();
    setCashierScannerStatus('Camera ready. Point it at a paid claim receipt QR.');

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Unable to prepare the camera QR scanner.');
    let lastScanAt = 0;
    const scanFrame = async () => {
      if (state.cashierScannerStream !== stream) return;
      try {
        if (
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          !state.cashierScanBusy &&
          Date.now() - lastScanAt >= 150
        ) {
          lastScanAt = Date.now();
          let qrContent = '';
          if (detector) {
            const codes = await detector.detect(video);
            qrContent = codes.find(item => item.rawValue)?.rawValue || '';
          } else {
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              const scale = Math.min(1, 720 / video.videoWidth);
              const width = Math.max(1, Math.round(video.videoWidth * scale));
              const height = Math.max(1, Math.round(video.videoHeight * scale));
              if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
              }
              context.drawImage(video, 0, 0, width, height);
              const pixels = context.getImageData(0, 0, width, height);
              qrContent = window.jsQR(pixels.data, width, height, {
                inversionAttempts: 'dontInvert'
              })?.data || '';
            }
          }
          if (qrContent) {
            stopCashierReceiptCamera();
            await scanCashierReceipt(qrContent);
            return;
          }
        }
        state.cashierScannerFrame = requestAnimationFrame(scanFrame);
      } catch (error) {
        stopCashierReceiptCamera();
        const message = error.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in browser site settings, then try again.'
          : `Camera scan failed: ${error.message}`;
        setCashierScannerStatus(message, true);
        toast(message);
      }
    };

    state.cashierScannerFrame = requestAnimationFrame(scanFrame);
  } catch (error) {
    stopCashierReceiptCamera();
    const message = error.name === 'NotAllowedError'
      ? 'Camera permission was denied. Allow camera access in browser site settings, then try again.'
      : `Unable to start camera: ${error.message}`;
    setCashierScannerStatus(message, true);
    toast(message);
  }
}

async function markClaimed(orderId) {
  if (!confirm(
    'Confirm payment is verified and the Bluebook is being physically released to the student?'
  )) {
    return;
  }

  try {
    await api(`/api/orders/${orderId}/claim`, {
      method: 'PATCH',
      body: '{}'
    });

    await refreshData();
    renderPage(state.page);

    toast(state.user.role === 'cashier'
      ? 'Handover confirmed and recorded in your cashier sales.'
      : 'Bluebook handover recorded.');

  } catch (error) {
    toast(error.message);
  }
}

async function cancelOrder(orderId) {
  const order = state.orders.find(item => item.id === orderId);
  if (!order) return toast('Order not found. Refresh the orders list and try again.');

  const isPaid = order.status === 'PAID';
  const isStudent = state.user.role === 'student';
  let reason = 'Cancelled by student.';
  if (!isStudent) {
    const suppliedReason = prompt(`Enter a reason for cancelling order ${order.ref}:`);
    if (suppliedReason === null) return;
    reason = suppliedReason.trim();
    if (!reason || reason.length > 500) {
      return toast('Enter a cancellation reason of 1 to 500 characters.');
    }
  }
  const confirmation = isPaid
    ? `Cancel paid order ${order.ref}? Its stock will return to available inventory. The refund must be claimed at the counter; no automatic refund is issued.`
    : `Cancel order ${order.ref}? Its reserved stock will be released. The order will remain in reports.`;
  const confirmed = confirm(confirmation);
  if (!confirmed) return;

  try {
    const result = await api(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
      method: 'PATCH',
      body: JSON.stringify({ reason })
    });
    await refreshData();
    renderPage(state.page);
    toast(result.message);
  } catch (error) {
    toast(error.message);
  }
}

async function showClaimReceipt(receiptNumber) {
  setStudentNotificationPanel(false);
  try {
    const receipt = await api(`/api/payments/receipt/${encodeURIComponent(receiptNumber)}`);
    const qr = await api(`/api/orders/${receipt.order._id}/qr`);

    $('#modalRoot').innerHTML = `
      <div class="modal-backdrop" data-backdrop>
        <div class="modal">

          <div class="modal-head">
            <div>
              <h3>Payment verified · claim receipt</h3>
              <p>${escapeHtml(receipt.receiptNumber)}</p>
            </div>

            <button class="modal-close" data-close-modal>×</button>
          </div>

          <div class="order-summary">
            <span>Order</span>
            <strong>${escapeHtml(receipt.order.reference)}</strong>
          </div>
          <div class="order-summary">
            <span>Bluebooks</span>
            <strong>${escapeHtml(receipt.order.productName)} × ${receipt.order.quantity}</strong>
          </div>
          <div class="order-summary">
            <span>Amount paid</span>
            <strong>${money(receipt.amount)}</strong>
          </div>
          <div class="order-summary">
            <span>Payment method</span>
            <strong>${paymentMethodLabel(receipt.payment?.method)}</strong>
          </div>

          <img
            src="${qr.qr}"
            alt="Paid order claim QR code"
            style="
              display:block;
              width:220px;
              height:220px;
              margin:18px auto
            "
          >

          <p style="
            text-align:center;
            font-size:11px;
            color:#8491a0
          ">
            Present this receipt QR only when collecting your Bluebook. The cashier will validate it
            and record the handover when scanned.
          </p>

          <button class="btn btn-primary btn-full" data-download-reference="${receipt.order._id}">
            Download claim receipt PDF
          </button>
          <button class="btn btn-light btn-full" data-download-claim-qr="${receipt.order._id}">
            Download QR image
          </button>
          <button
            class="btn btn-light btn-full"
            data-close-modal
          >
            Done
          </button>

        </div>
      </div>
    `;

  } catch (error) {
    toast(error.message);
  }
}

async function downloadOrderReference(orderId) {
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/reference.pdf`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Reference download failed (${response.status}).`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const order = state.orders.find(item => item.id === orderId);
    const link = document.createElement('a');
    link.href = url;
    link.download = `BlueBook-${order?.receiptNumber || order?.ref || 'reference'}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    toast(error.message);
  }
}

async function downloadClaimQr(orderId) {
  try {
    const qr = await api(`/api/orders/${encodeURIComponent(orderId)}/qr`);
    const link = document.createElement('a');
    link.href = qr.qr;
    link.download = `BlueBook-${qr.reference}-claim-qr.png`;
    document.body.append(link);
    link.click();
    link.remove();
  } catch (error) {
    toast(error.message);
  }
}

function filterAdminOrders() {
  const q = ($('#orderSearch')?.value || '').toLowerCase();

  const status =
    $('#orderStatusFilter')?.value || 'all';

  const list = state.orders.filter(o =>
    (
      (o.ref || '').toLowerCase().includes(q) ||
      (o.studentName || '').toLowerCase().includes(q)
    ) &&
    (status === 'all' || o.status === status)
  );

  const target = $('#adminOrdersTable');

  if (target) {
    target.innerHTML = ordersTable(list, true);
  }
}

// Global click event listener
document.addEventListener('click', async e => {
  if (e.target.closest('[data-theme-toggle]')) {
    toggleTheme();
  }

  if (!e.target.closest('#studentNotificationArea')) {
    setStudentNotificationPanel(false);
  }

  if (e.target.closest('#studentNotificationButton')) {
    const panel = $('#studentNotificationPanel');
    setStudentNotificationPanel(panel.classList.contains('hidden'));
  }

  if (e.target.closest('#closeStudentNotifications')) {
    setStudentNotificationPanel(false);
  }

  const dismissNotification = e.target.closest('[data-dismiss-notification]');
  if (dismissNotification) {
    dismissStudentNotification(
      dismissNotification.dataset.dismissNotification,
      dismissNotification.closest('.notification-item')
    );
  }

  if (e.target.closest('[data-start-cashier-camera]')) {
    startCashierReceiptCamera();
  }

  const auth = e.target.closest('[data-auth-tab]');

  if (auth) {
    setAuthTab(auth.dataset.authTab);
  }

  const go = e.target.closest('[data-go]');

  if (go) {
    navigate(go.dataset.go);
  }

  const product = e.target.closest('[data-order-product]');

  if (product) {
    openOrderModal(product.dataset.orderProduct);
  }

  const stock = e.target.closest('[data-edit-stock]');

  if (stock) {
    updateStock(stock.dataset.editStock);
  }

  const stockRefresh = e.target.closest('[data-refresh-student-stock]');
  if (stockRefresh) {
    refreshStudentStock()
      .then(() => syncStudentStockRefresh(state.page))
      .catch(error => toast(`Stock refresh failed: ${error.message}`));
  }

  const cashierRefresh = e.target.closest('[data-refresh-cashier-dashboard]');
  if (cashierRefresh) {
    try {
      stopCashierReceiptCamera();
      await refreshData();
      renderPage('cashierDashboard');
      toast('Stock, sales, and cashier history refreshed.');
    } catch (error) {
      toast(`Cashier dashboard refresh failed: ${error.message}`);
    }
  }

  if (e.target.closest('[data-report-refresh]')) {
    loadAdminReport(state.reportPeriod);
  }

  const uploadPayment = e.target.closest('[data-upload-payment]');
  if (uploadPayment) {
    openPaymentUpload(uploadPayment.dataset.uploadPayment);
  }

  const counterQr = e.target.closest('[data-show-counter-qr]');
  if (counterQr) {
    showCounterPaymentQr(counterQr.dataset.showCounterQr);
  }

  const downloadReference = e.target.closest('[data-download-reference]');
  if (downloadReference) {
    downloadOrderReference(downloadReference.dataset.downloadReference);
  }

  const downloadClaimQrButton = e.target.closest('[data-download-claim-qr]');
  if (downloadClaimQrButton) {
    downloadClaimQr(downloadClaimQrButton.dataset.downloadClaimQr);
  }

  const counterPayment = e.target.closest('[data-counter-payment]');
  if (counterPayment) {
    recordCounterPayment(counterPayment.dataset.counterPayment);
  }

  const paymentReview = e.target.closest('[data-review-payment]');
  if (paymentReview) {
    reviewPayment(paymentReview.dataset.reviewPayment);
  }

  const paymentVerify = e.target.closest('[data-verify-payment]');
  if (paymentVerify) {
    verifyPayment(paymentVerify.dataset.verifyPayment);
  }

  const claim = e.target.closest('[data-claim-order]');

  if (claim) {
    markClaimed(claim.dataset.claimOrder);
  }

  const cancelOrderButton = e.target.closest('[data-cancel-order]');
  if (cancelOrderButton) {
    cancelOrder(cancelOrderButton.dataset.cancelOrder);
  }

  const priceButton = e.target.closest('[data-edit-price]');
  if (priceButton) {
    updatePrice(priceButton.dataset.editPrice);
  }

  if (e.target.closest('[data-edit-counter-expiration]')) {
    updateCounterExpiration();
  }

  const receipt = e.target.closest('[data-show-receipt]');

  if (receipt) {
    showClaimReceipt(receipt.dataset.showReceipt);
  }

  if (
    e.target.closest('[data-close-modal]') ||
    e.target.matches('[data-backdrop]')
  ) {
    if (state.paymentPreviewUrl) URL.revokeObjectURL(state.paymentPreviewUrl);
    state.paymentPreviewUrl = '';
    $('#modalRoot').innerHTML = '';
  }

  if (e.target.closest('#logoutBtn')) {
    logout();
  }

  if (e.target.closest('#menuToggle')) {
    $('#sidebar').classList.toggle('open');
  }

  const nav = e.target.closest('[data-page]');

  if (nav) {
    navigate(nav.dataset.page);
  }

  const toggle = e.target.closest('[data-toggle-password]');

  if (toggle) {
    const input = $(`#${toggle.dataset.togglePassword}`);

    input.type =
      input.type === 'password'
        ? 'text'
        : 'password';

    toggle.textContent =
      input.type === 'password'
        ? 'Show'
        : 'Hide';
  }
});

document.addEventListener('change', async e => {
  const fileInput = e.target.closest('[data-receipt-qr-upload]');
  if (!fileInput) return;
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) await handleReceiptQrUpload(file);
});

document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-cashier-scan-form]');
  if (!form) return;
  e.preventDefault();
  const input = $('#cashierReceiptScanInput', form);
  if (!input?.value.trim()) {
    setCashierScannerStatus('Scan, upload, or enter a claim receipt QR first.', true);
    input?.focus();
    return;
  }
  await scanCashierReceipt(input?.value);
});

document.addEventListener('pointerdown', e => {
  const item = e.target.closest('.notification-item');
  if (!item || e.button !== 0 || e.target.closest('button')) return;

  state.notificationSwipe = {
    item,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    deltaX: 0,
    active: false
  };
  item.setPointerCapture(e.pointerId);
});

document.addEventListener('pointermove', e => {
  const swipe = state.notificationSwipe;
  if (!swipe || swipe.pointerId !== e.pointerId) return;

  const deltaX = e.clientX - swipe.startX;
  const deltaY = e.clientY - swipe.startY;
  if (!swipe.active && (deltaX < 8 || deltaX < Math.abs(deltaY))) return;
  swipe.active = true;
  swipe.deltaX = Math.max(0, deltaX);
  swipe.item.classList.add('is-dragging');
  swipe.item.style.transform = `translateX(${Math.min(swipe.deltaX, 220)}px)`;
  swipe.item.style.opacity = String(Math.max(0.35, 1 - swipe.deltaX / 400));
});

function finishNotificationSwipe(e) {
  const swipe = state.notificationSwipe;
  if (!swipe || swipe.pointerId !== e.pointerId) return;
  state.notificationSwipe = null;
  if (swipe.active && swipe.deltaX >= 90) {
    dismissStudentNotification(
      swipe.item.querySelector('[data-dismiss-notification]')?.dataset.dismissNotification,
      swipe.item
    );
    return;
  }
  swipe.item.classList.remove('is-dragging');
  swipe.item.style.transform = '';
  swipe.item.style.opacity = '';
}

document.addEventListener('pointerup', finishNotificationSwipe);
document.addEventListener('pointercancel', finishNotificationSwipe);

// Search orders while typing
document.addEventListener('input', e => {
  if (e.target.id === 'orderSearch') {
    filterAdminOrders();
  }
  if (e.target.id === 'studentSearch') {
    clearTimeout(state.studentSearchTimer);
    const query = e.target.value;
    state.studentSearchTimer = setTimeout(() => searchStudents(query), 250);
  }
});

// Filter orders by status
document.addEventListener('change', e => {
  if (e.target.id === 'orderStatusFilter') {
    filterAdminOrders();
  }
  if (e.target.id === 'reportPeriodFilter') {
    loadAdminReport(e.target.value);
  }
});

// Student and administrator login
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();

  const form = e.currentTarget;

  setBusy(form, true);

  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: $('#loginEmail').value.trim(),
        password: $('#loginPassword').value
      })
    });

    state.token = result.token;

    localStorage.setItem('bb_token', state.token);

    showApp(result.user);

    await refreshData();
    renderPage(state.page);

  } catch (error) {
    toast(error.message);

  } finally {
    setBusy(form, false);
  }
});

// Student registration
$('#registerForm').addEventListener('submit', async e => {
  e.preventDefault();

  const form = e.currentTarget;

  setBusy(form, true);

  try {
    const result = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#registerName').value.trim(),
        studentId: $('#registerStudentId').value.trim(),
        email: $('#registerEmail').value.trim(),
        password: $('#registerPassword').value
      })
    });

    state.token = result.token;

    localStorage.setItem('bb_token', state.token);

    showApp(result.user);

    await refreshData();
    renderPage(state.page);

    toast('Student account created successfully.');

  } catch (error) {
    toast(error.message);

  } finally {
    setBusy(form, false);
  }
});

// Restore existing login session
async function restoreSession() {
  if (!state.token) return;

  try {
    const result = await api('/api/auth/me');

    showApp(result.user);

    await refreshData();
    renderPage(state.page);

  } catch (_error) {
    logout(false);
  }
}

restoreSession();