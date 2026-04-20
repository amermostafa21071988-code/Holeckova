const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = 3000;

// =========================
// إعدادات عامة
// =========================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// =========================
// بيانات الإدارة
// =========================
const ADMIN_USER = "admin";
const ADMIN_PASS = "1234";

app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    res.json({
        success: username === ADMIN_USER && password === ADMIN_PASS
    });
});

// =========================
// الملفات
// =========================
const uploadDir = path.join(__dirname, "uploads");
const dataFile = path.join(__dirname, "orders.json");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, "[]");

// =========================
// رفع الصور
// =========================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage });

// =========================
// قراءة / حفظ
// =========================
function getOrders() {
    try {
        return JSON.parse(fs.readFileSync(dataFile, "utf8"));
    } catch {
        return [];
    }
}

function saveOrders(orders) {
    fs.writeFileSync(dataFile, JSON.stringify(orders, null, 2));
}

// =========================
// إنشاء طلب جديد من الفورم
// =========================
app.post("/api/order",
upload.fields([
    { name: "frontImg" },
    { name: "backImg" },
    { name: "rightImg" },
    { name: "leftImg" }
]),
(req, res) => {
    const orders = getOrders();
    const now = new Date();

    const images = [];

    if (req.files?.frontImg) images.push("/uploads/" + req.files.frontImg[0].filename);
    if (req.files?.backImg) images.push("/uploads/" + req.files.backImg[0].filename);
    if (req.files?.rightImg) images.push("/uploads/" + req.files.rightImg[0].filename);
    if (req.files?.leftImg) images.push("/uploads/" + req.files.leftImg[0].filename);

    const order = {
        id: "ORD-" + Date.now(),
        phone: req.body.phone || "",
        service: req.body.service || "",
        problem: req.body.problem || "",
        location: req.body.location || "",
        lat: req.body.lat || "",
        lng: req.body.lng || "",
        status: "جديد",
        driver: "",
        images,
        chat: [],
        unreadAdmin: 0,

        date: now.toLocaleDateString("ar-EG"),
        time: now.toLocaleTimeString("ar-EG", {
            hour: "2-digit",
            minute: "2-digit"
        }),

        lastUpdate: now.toLocaleString("ar-EG")
    };

    orders.unshift(order);
    saveOrders(orders);

    io.emit("newOrder", order);

    res.json({
        success: true,
        orderId: order.id
    });
});

// =========================
// عرض الطلبات
// =========================
app.get("/api/orders", (req, res) => {
    res.json(getOrders());
});

// =========================
// تعيين سائق
// =========================
app.post("/api/assign-driver", (req, res) => {
    const { id, driver } = req.body;
    const orders = getOrders();

    orders.forEach(order => {
        if (order.id === id) {
            order.driver = driver;
            order.status = "جارى التنفيذ";
            order.lastUpdate = new Date().toLocaleString("ar-EG");
        }
    });

    saveOrders(orders);
    io.emit("ordersUpdated", orders);

    res.json({ success: true });
});

// =========================
// تحديث الحالة
// =========================
app.post("/api/update-status", (req, res) => {
    const { id, status } = req.body;
    const orders = getOrders();

    orders.forEach(order => {
        if (order.id === id) {
            order.status = status;
            order.lastUpdate = new Date().toLocaleString("ar-EG");
        }
    });

    saveOrders(orders);
    io.emit("ordersUpdated", orders);

    res.json({ success: true });
});

// =========================
// تصفير عداد الرسائل
// =========================
app.post("/api/read-chat", (req, res) => {
    const { id } = req.body;
    const orders = getOrders();

    orders.forEach(order => {
        if (order.id === id) {
            order.unreadAdmin = 0;
        }
    });

    saveOrders(orders);
    io.emit("ordersUpdated", orders);

    res.json({ success: true });
});

// =========================
// Socket.IO
// =========================
io.on("connection", (socket) => {

    socket.on("joinRoom", (roomId) => {
        socket.join(roomId);
    });

    socket.on("typing", (data) => {
        socket.to(data.room).emit("typing", data);
    });

    // =========================
    // استقبال طلب جديد مباشر من العميل
    // =========================
    socket.on("newOrder", (data) => {
        const orders = getOrders();
        const now = new Date();

        const order = {
            id: "ORD-" + Date.now(),
            phone: data.phone || "",
            service: data.service || "",
            problem: data.problem || "",
            location: data.location || "",
            lat: data.lat || "",
            lng: data.lng || "",
            images: data.images || [],
            chat: [],
            unreadAdmin: 0,
            driver: "",
            status: "جديد",

            date: now.toLocaleDateString("ar-EG"),
            time: now.toLocaleTimeString("ar-EG", {
                hour: "2-digit",
                minute: "2-digit"
            }),

            lastUpdate: now.toLocaleString("ar-EG")
        };

        orders.unshift(order);
        saveOrders(orders);

        io.emit("newOrder", order);
    });

    // رسالة العميل
    socket.on("clientMessage", (data) => {
        const message = {
            sender: "👤 العميل",
            text: data.text,
            time: new Date().toLocaleString("ar-EG")
        };

        const orders = getOrders();

        orders.forEach(order => {
            if (order.id === data.room) {
                if (!Array.isArray(order.chat)) order.chat = [];
                order.chat.push(message);
                order.lastUpdate = message.time;
                order.unreadAdmin = (order.unreadAdmin || 0) + 1;
            }
        });

        saveOrders(orders);
        io.emit("ordersUpdated", orders);

        io.to(data.room).emit("newMessage", {
            room: data.room,
            ...message
        });
    });

    // رسالة الإدارة
    socket.on("adminMessage", (data) => {
        const message = {
            sender: "🛠 الإدارة",
            text: data.text,
            time: new Date().toLocaleString("ar-EG")
        };

        const orders = getOrders();

        orders.forEach(order => {
            if (order.id === data.room) {
                if (!Array.isArray(order.chat)) order.chat = [];
                order.chat.push(message);
                order.lastUpdate = message.time;
            }
        });

        saveOrders(orders);
        io.emit("ordersUpdated", orders);

        io.to(data.room).emit("newMessage", {
            room: data.room,
            ...message
        });
    });

    // =========================
    // استقبال موقع السائق المباشر
    // =========================
    socket.on("driverLocation", (data) => {
        io.to(data.room).emit("updateDriverLocation", {
            driver: data.driver,
            lat: data.lat,
            lng: data.lng
        });
    });

});

// =========================
// تشغيل السيرفر
// =========================
server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});