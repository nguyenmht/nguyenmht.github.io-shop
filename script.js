const SOURCE_PATH = "Source.txt";

const state = {
  ready: false,
  products: new Map(),
  orderedProductIds: [],
};

const dom = {
  form: document.getElementById("product-form"),
  input: document.getElementById("product-input"),
  feedback: document.getElementById("feedback"),
  results: document.getElementById("results"),
};

renderInfo("Đang tải dữ liệu sản phẩm…");
bootstrap();

async function bootstrap() {
  try {
    const response = await fetch(SOURCE_PATH);
    if (!response.ok) {
      throw new Error(`Không thể tải Source.txt (HTTP ${response.status})`);
    }
    const rawText = await response.text();
    state.products = parseSource(rawText);
    state.ready = true;
    renderInfo("Dữ liệu đã sẵn sàng. Nhập ID sản phẩm và bấm Tra cứu.");
  } catch (error) {
    renderError([
      "Không thể đọc dữ liệu từ Source.txt.",
      "Kiểm tra lại file hoặc thử tải lại trang.",
    ]);
    console.error(error);
    dom.form.querySelector("button[type=submit]").disabled = true;
    return;
  }

  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.ready) {
      return;
    }
    const rawValue = dom.input.value.trim();
    if (!rawValue) {
      renderError(["Vui lòng nhập ít nhất một ID sản phẩm."]);
      dom.results.innerHTML = "";
      return;
    }

    const parsedIds = Array.from(
      new Set(
        rawValue
          .split(";")
          .map((token) => token.trim().toLowerCase())
          .filter(Boolean)
      )
    );

    if (!parsedIds.length) {
      renderError(["Không tìm thấy ID hợp lệ sau khi xử lý đầu vào."]);
      dom.results.innerHTML = "";
      return;
    }

    processQuery(parsedIds);
  });

  dom.input.addEventListener("keydown", (event) => {
    if (event.isComposing) {
      return;
    }
    const isModifier = event.shiftKey || event.ctrlKey || event.altKey || event.metaKey;
    if (event.key === "Enter" && !isModifier) {
      event.preventDefault();
      dom.form.requestSubmit();
    }
  });
}

function parseSource(text) {
  const productMap = new Map();
  const lines = text.split(/\r?\n/);
  let current = null;

  const finalize = () => {
    if (!current) return;
    const id = current.id;
    const existing = productMap.get(id);
    const uniqueStores = new Set(
      current.stores.filter(Boolean).map((store) => store.trim())
    );

    if (existing) {
      existing.stores.forEach((store) => uniqueStores.add(store));
    }

    const stores = Array.from(uniqueStores);
    productMap.set(id, {
      id,
      url: current.url,
      name: current.name,
      stores,
      isOutOfStock: stores.length === 0,
    });
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith("🖼")) {
      finalize();
      const url = line.replace(/^🖼\s*/, "").trim();
      const slug = url.split("/").pop() ?? "";
      const cleanSlug = slug.split("?")[0] || slug;
      const idPart = extractProductId(cleanSlug);
      current = {
        url,
        id: idPart,
        name: humanizeSlug(cleanSlug, idPart),
        stores: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.toLowerCase() === "hết hàng") {
      current.stores = [];
      continue;
    }

    const cleanedStore = line.replace(/^-\s*/, "").trim();
    current.stores.push(cleanedStore);
  }

  finalize();
  return productMap;
}

function extractProductId(slug) {
  const clean = slug.replace(".html", "");
  const segments = clean.split("-");
  const lastSegment = segments.pop() ?? clean;
  return lastSegment.toLowerCase();
}

function humanizeSlug(slug, productId) {
  const clean = slug.replace(".html", "");
  const parts = clean.split("-");
  if (parts.length === 0) return productId.toUpperCase();
  const core = parts.slice(0, -1);
  if (!core.length) return productId.toUpperCase();
  return core
    .map((piece) => formatWord(piece))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatWord(word) {
  if (!word) return "";
  if (word.length <= 3) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function processQuery(productIds) {
  const warnings = [];
  const errors = [];
  const unavailable = [];
  const missing = [];
  const availableProducts = [];
  const productIndex = new Map();

  productIds.forEach((id) => {
    const product = state.products.get(id);
    if (!product) {
      missing.push(id);
      return;
    }
    if (product.stores.length === 0) {
      unavailable.push(product);
      return;
    }
    availableProducts.push(product);
    productIndex.set(id, product);
  });

  if (missing.length) {
    errors.push(
      `Không tìm thấy trong dữ liệu: ${missing
        .map((id) => id.toUpperCase())
        .join(", ")}`
    );
  }

  if (unavailable.length) {
    warnings.push(
      `Đã hết hàng: ${unavailable
        .map((product) => productDisplayLabel(product))
        .join(", ")}`
    );
  }

  if (!availableProducts.length) {
    renderPayload({ warnings, errors, stores: [] });
    return;
  }

  const storeMap = new Map();
  availableProducts.forEach((product) => {
    product.stores.forEach((storeName) => {
      const name = storeName.trim();
      if (!name) return;
      if (!storeMap.has(name)) {
        storeMap.set(name, {
          name,
          productSet: new Set(),
          products: [],
        });
      }
      const store = storeMap.get(name);
      if (!store.productSet.has(product.id)) {
        store.productSet.add(product.id);
        store.products.push(product.id);
      }
    });
  });

  const stores = prioritiseStores(
    Array.from(storeMap.values()).map((store) => ({
      name: store.name,
      products: store.products.slice(),
    })),
    productIds,
    productIndex
  );

  renderPayload({ warnings, errors, stores, totalProducts: availableProducts.length, productIndex });
}

function prioritiseStores(stores, requestedIds, productIndex) {
  const requestedOrder = requestedIds.filter((id) => productIndex.has(id));
  const augmented = stores
    .map((store) => ({
      ...store,
      products: requestedOrder.filter((id) => store.products.includes(id)),
    }))
    .filter((store) => store.products.length > 0);

  augmented.sort((a, b) => {
    if (b.products.length !== a.products.length) {
      return b.products.length - a.products.length;
    }
    return a.name.localeCompare(b.name, "vi", { sensitivity: "base" });
  });

  const ordered = [];
  const covered = new Set();

  let i = 0;
  while (i < augmented.length) {
    const currentSize = augmented[i].products.length;
    const sameSize = [];

    while (i < augmented.length && augmented[i].products.length === currentSize) {
      sameSize.push(augmented[i]);
      i += 1;
    }

    const bucket = sameSize.slice();
    while (bucket.length) {
      bucket.sort((a, b) => {
        const aNew = countNewProducts(a.products, covered);
        const bNew = countNewProducts(b.products, covered);
        if (bNew !== aNew) return bNew - aNew;
        return a.name.localeCompare(b.name, "vi", { sensitivity: "base" });
      });
      const next = bucket.shift();
      ordered.push({
        ...next,
        introduces: countNewProducts(next.products, covered),
      });
      next.products.forEach((pid) => covered.add(pid));
    }
  }

  return ordered;
}

function countNewProducts(products, coveredSet) {
  return products.reduce(
    (count, productId) => count + (coveredSet.has(productId) ? 0 : 1),
    0
  );
}

function renderPayload({ warnings = [], errors = [], stores = [], totalProducts = 0, productIndex = new Map() }) {
  dom.feedback.innerHTML = "";
  dom.results.innerHTML = "";

  if (errors.length) {
    const alert = buildAlert("alert alert-danger", errors);
    dom.feedback.appendChild(alert);
  }

  if (warnings.length) {
    const alert = buildAlert("alert alert-warning", warnings);
    dom.feedback.appendChild(alert);
  }

  if (!errors.length && !warnings.length && stores.length) {
    const successMessage = `Tìm thấy ${stores.length} cửa hàng phù hợp.`;
    const alert = buildAlert("alert alert-success", [successMessage]);
    dom.feedback.appendChild(alert);
  }

  if (!stores.length) {
    if (!errors.length && !warnings.length) {
      renderInfo("Không có cửa hàng nào đáp ứng các sản phẩm đã chọn.");
    }
    return;
  }

  stores.forEach((store) => {
    const card = document.createElement("article");
    card.className = "store-card";

    const header = document.createElement("div");
    header.className = "store-header";

    const name = document.createElement("h3");
    name.className = "store-name";
    name.textContent = store.name;
    header.appendChild(name);

    const badge = document.createElement("span");
    badge.className = "store-badge";
    const total = totalProducts || Math.max(...stores.map((s) => s.products.length));
    if (store.products.length === total) {
      badge.textContent = `Đủ ${store.products.length} sản phẩm`;
      badge.classList.add("store-badge--all");
    } else {
      badge.textContent = `${store.products.length} sản phẩm`;
    }
    header.appendChild(badge);

    card.appendChild(header);

    const list = document.createElement("ul");
    list.className = "product-list";
    store.products.forEach((productId) => {
      const product = productIndex.get(productId);
      if (!product) return;
      const item = document.createElement("li");

      const link = document.createElement("a");
      link.href = product.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = product.name;

      const idTag = document.createElement("span");
      idTag.className = "product-id";
      idTag.textContent = productId.toUpperCase();

      item.appendChild(link);
      item.appendChild(idTag);
      list.appendChild(item);
    });

    card.appendChild(list);
    dom.results.appendChild(card);
  });
}

function renderInfo(message) {
  dom.feedback.innerHTML = "";
  const alert = buildAlert("alert alert-success", [message]);
  dom.feedback.appendChild(alert);
}

function renderError(lines) {
  dom.feedback.innerHTML = "";
  const alert = buildAlert("alert alert-danger", Array.isArray(lines) ? lines : [lines]);
  dom.feedback.appendChild(alert);
}

function buildAlert(className, lines) {
  const container = document.createElement("div");
  container.className = className;
  lines.forEach((line) => {
    const p = document.createElement("p");
    p.textContent = line;
    container.appendChild(p);
  });
  return container;
}

function productDisplayLabel(product) {
  return `${product.name} (${product.id.toUpperCase()})`;
}
