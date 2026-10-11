/**
 * NIVORA ONE - International E-Commerce & Tracking Ecosystem
 * Main JavaScript Controller
 */

// Global State & Data
let currentCurrency = 'bdt';
const currencyRates = { bdt: 1, usd: 0.0085, eur: 0.0078 };
const currencySymbols = { bdt: '৳', usd: '$', eur: '€' };

let products = [
    { id: 1, name: 'NIVORA Enterprise Kit', price: 2500, discount: 10, category: 'software', vendor: 'Nivora Tech Ltd' },
    { id: 2, name: 'Cloud Server Node', price: 4800, discount: 5, category: 'hardware', vendor: 'Global Cloud BD' },
    { id: 3, name: 'AI Smart Analytics', price: 1800, discount: 15, category: 'software', vendor: 'AI Studio Corp' },
    { id: 4, name: 'German Homoeo Consultation Package', price: 1200, discount: 0, category: 'services', vendor: 'Digital German Homoeo Hall' }
];

let cart = [];

// 1. Live Bangla Clock Initializer
function updateClock() {
    const now = new Date();
    const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    const clockElement = document.getElementById('live-clock');
    if(clockElement) {
        clockElement.innerHTML = `<i class="fa-regular fa-clock mr-1.5 text-xs text-emerald-400"></i><span>${now.toLocaleDateString('bn-BD', options)}</span>`;
    }
}
setInterval(updateClock, 1000);
updateClock();

// 2. Render Products & Offers Grid
function renderProducts() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;

    const searchInput = document.getElementById('search-input');
    const categorySelect = document.getElementById('filter-category');
    
    const search = searchInput ? searchInput.value.toLowerCase() : '';
    const category = categorySelect ? categorySelect.value : 'all';
    
    grid.innerHTML = '';
    let filtered = products.filter(p => {
        let matchesSearch = p.name.toLowerCase().includes(search) || p.vendor.toLowerCase().includes(search);
        let matchesCat = category === 'all' || p.category === category;
        return matchesSearch && matchesCat;
    });

    const statProducts = document.getElementById('stat-products');
    if(statProducts) statProducts.innerText = products.length;

    if(filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-8 text-xs text-slate-500">কোনো প্রডাক্ট পাওয়া যায়নি।</div>`;
        return;
    }

    filtered.forEach((p, index) => {
        let finalPrice = p.price - (p.price * p.discount / 100);
        let convertedPrice = (finalPrice * currencyRates[currentCurrency]).toFixed(2);
        let originalConverted = (p.price * currencyRates[currentCurrency]).toFixed(2);

        grid.innerHTML += `
            <div class="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col justify-between space-y-3 shadow-md hover:border-slate-700 transition">
                <div>
                    <div class="flex justify-between items-start mb-2">
                        <span class="bg-slate-950 text-cyan-400 px-2 py-0.5 rounded text-[10px] border border-slate-800 uppercase font-medium">${p.category}</span>
                        ${p.discount > 0 ? `<span class="bg-rose-500/20 text-rose-400 px-2 py-0.5 rounded text-[10px] font-bold">-${p.discount}%</span>` : ''}
                    </div>
                    <h4 class="font-bold text-xs text-slate-100 line-clamp-1">${p.name}</h4>
                    <p class="text-[10px] text-slate-400 mt-0.5"><i class="fa-solid fa-shop mr-1"></i>${p.vendor}</p>
                </div>
                <div class="flex items-baseline space-x-2">
                    <span class="text-sm font-bold text-emerald-400">${currencySymbols[currentCurrency]} ${convertedPrice}</span>
                    ${p.discount > 0 ? `<span class="text-[10px] text-slate-500 line-through">${currencySymbols[currentCurrency]}${originalConverted}</span>` : ''}
                </div>
                <div class="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-800">
                    <button onclick="addToCart(${p.id})" class="bg-cyan-600 hover:bg-cyan-500 text-white py-1.5 rounded-xl text-[11px] font-medium transition">কার্টে নিন</button>
                    <div class="flex space-x-1">
                        <button onclick="editProduct(${index})" class="flex-1 bg-slate-800 hover:bg-slate-700 text-amber-400 py-1.5 rounded-xl text-[11px]" title="এডিট"><i class="fa-solid fa-pen"></i></button>
                        <button onclick="deleteProduct(${index})" class="flex-1 bg-slate-800 hover:bg-slate-700 text-rose-400 py-1.5 rounded-xl text-[11px]" title="ডিলিট"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            </div>
        `;
    });
}

// 3. Add / Edit Product Handler
function saveProduct() {
    const editIndex = parseInt(document.getElementById('edit-index').value);
    const name = document.getElementById('p-name').value.trim();
    const price = parseFloat(document.getElementById('p-price').value);
    const discount = parseFloat(document.getElementById('p-discount').value) || 0;
    const category = document.getElementById('p-category').value;
    const vendor = document.getElementById('p-vendor').value.trim() || 'NIVORA Partner';

    if(!name || isNaN(price)) {
        alert('দয়া করে প্রডাক্টের নাম এবং সঠিক মূল্য প্রদান করুন।');
        return;
    }

    if(editIndex >= 0) {
        products[editIndex] = { id: products[editIndex].id, name, price, discount, category, vendor };
        alert('প্রডাক্ট সফলভাবে আপডেট করা হয়েছে!');
    } else {
        products.push({ id: Date.now(), name, price, discount, category, vendor });
        alert('নতুন প্রডাক্ট সফলভাবে যুক্ত করা হয়েছে!');
    }

    closeModal('product-modal');
    renderProducts();
    resetProductForm();
}

function editProduct(index) {
    const p = products[index];
    document.getElementById('edit-index').value = index;
    document.getElementById('p-name').value = p.name;
    document.getElementById('p-price').value = p.price;
    document.getElementById('p-discount').value = p.discount;
    document.getElementById('p-category').value = p.category;
    document.getElementById('p-vendor').value = p.vendor;
    document.getElementById('modal-title').innerHTML = `<i class="fa-solid fa-pen-to-square mr-2"></i>প্রডাক্ট এডিট করুন`;
    openModal('product-modal');
}

function deleteProduct(index) {
    if(confirm('আপনি কি নিশ্চিতভাবে প্রডাক্টটি ডিলিট করতে চান?')) {
        products.splice(index, 1);
        renderProducts();
    }
}

function resetProductForm() {
    document.getElementById('edit-index').value = '-1';
    document.getElementById('p-name').value = '';
    document.getElementById('p-price').value = '';
    document.getElementById('p-discount').value = '';
    document.getElementById('p-vendor').value = '';
    document.getElementById('modal-title').innerHTML = `<i class="fa-solid fa-box mr-2"></i>নতুন প্রডাক্ট যুক্ত করুন`;
}

// 4. Cart & Checkout Management
function addToCart(id) {
    const product = products.find(p => p.id === id);
    const existing = cart.find(item => item.id === id);
    if(existing) {
        existing.qty++;
    } else {
        cart.push({ ...product, qty: 1 });
    }
    updateCartUI();
    alert('প্রডাক্ট কার্টে সফলভাবে যোগ করা হয়েছে!');
}

function updateCartUI() {
    const list = document.getElementById('cart-items-list');
    if (!list) return;

    list.innerHTML = '';
    let total = 0, totalCount = 0;

    cart.forEach((item, index) => {
        let finalPrice = item.price - (item.price * item.discount / 100);
        let itemTotal = (finalPrice * currencyRates[currentCurrency] * item.qty).toFixed(2);
        total += parseFloat(itemTotal);
        totalCount += item.qty;

        list.innerHTML += `
            <div class="flex justify-between items-center bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <div>
                    <p class="font-bold text-slate-200">${item.name}</p>
                    <p class="text-[10px] text-slate-400">${currencySymbols[currentCurrency]} ${itemTotal} (পরিমাণ: ${item.qty})</p>
                </div>
                <button onclick="removeFromCart(${index})" class="text-rose-400 hover:text-rose-300 p-1"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
    });

    const badge = document.getElementById('cart-badge');
    const totalEl = document.getElementById('cart-total');
    if(badge) badge.innerText = totalCount;
    if(totalEl) totalEl.innerText = currencySymbols[currentCurrency] + ' ' + total.toFixed(2);
}

function removeFromCart(index) {
    cart.splice(index, 1);
    updateCartUI();
}

function openCartDrawer() { 
    const drawer = document.getElementById('cart-drawer');
    if(drawer) drawer.classList.remove('translate-x-full'); 
}

function closeCartDrawer() { 
    const drawer = document.getElementById('cart-drawer');
    if(drawer) drawer.classList.add('translate-x-full'); 
}

function checkoutOrder() {
    if(cart.length === 0) {
        alert('আপনার কার্ট খালি রয়েছে!');
        return;
    }
    const orderId = 'NIV-' + Math.floor(1000 + Math.random() * 9000);
    alert(`অর্ডার সফলভাবে সম্পন্ন হয়েছে! আপনার ট্র্যাকিং আইডি: ${orderId}`);
    cart = [];
    updateCartUI();
    closeCartDrawer();
}

// 5. Currency Switcher
function changeCurrency(curr) {
    currentCurrency = curr;
    renderProducts();
    updateCartUI();
}

// 6. Order Tracking System
function trackOrder() {
    const inputField = document.getElementById('tracking-id-input');
    const resBox = document.getElementById('tracking-result');
    if (!inputField || !resBox) return;

    const id = inputField.value.trim();
    if(!id) {
        alert('দয়া করে সঠিক অর্ডার আইডি দিন।');
        return;
    }
    resBox.classList.remove('hidden');
    resBox.innerHTML = `অর্ডার আইডি <span class="text-cyan-400 font-bold">${id}</span> এর বর্তমান স্ট্যাটাস: <span class="text-emerald-400 font-bold">প্যাকিং সম্পন্ন হয়েছে এবং ডিসপ্যাচের জন্য প্রস্তুত (In Transit)</span>`;
}

// 7. Referral Link Publisher Tool
function copyRefLink() {
    const input = document.getElementById('ref-product-link');
    if (!input) return;
    input.select();
    navigator.clipboard.writeText(input.value);
    alert('পাবলিশার রেফারেল লিংক সফলভাবে কপি করা হয়েছে!');
}

// 8. General Modal Controls
function openModal(modalId) { 
    const modal = document.getElementById(modalId);
    if(modal) modal.classList.remove('hidden'); 
}

function closeModal(modalId) { 
    const modal = document.getElementById(modalId);
    if(modal) modal.classList.add('hidden'); 
}

// Initial Call on Load
document.addEventListener('DOMContentLoaded', () => {
    renderProducts();
});
