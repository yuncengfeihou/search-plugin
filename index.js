import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "search-plugin";
const extensionSettings = extension_settings[extensionName] || {};
const defaultSettings = {
    searchScope: "loaded", // "loaded" 或 "full"，默认只检索已加载消息
    realTimeRendering: true, // 默认开启实时渲染
    highlightKeywords: true // 默认开启关键词高亮
};

// 初始化插件设置
function initSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
}

// 获取聊天记录（支持全文检索）
async function fetchChatLog(chatId, start = 0, end) {
    try {
        // 获取当前的 accessToken
        const accessToken = document.cookie
            .split('; ')
            .find(row => row.startsWith('accessToken='))
            ?.split('=')[1];
            
        if (!accessToken) {
            throw new Error("未找到访问令牌");
        }

        const url = `/api/shells/chat/getchatlog?chatid=${chatId}&start=${start}${end ? `&end=${end}` : ''}`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Cookie": `accessToken=${accessToken}`
            },
            credentials: 'include' // 添加这行确保发送 cookies
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("获取聊天记录失败:", error);
        throw error;
    }
}

// 获取聊天记录总长度
async function getChatLogLength(chatId) {
    try {
        // 获取当前的 accessToken
        const accessToken = document.cookie
            .split('; ')
            .find(row => row.startsWith('accessToken='))
            ?.split('=')[1];
            
        if (!accessToken) {
            throw new Error("未找到访问令牌");
        }

        const response = await fetch(`/api/shells/chat/getchatloglength?chatid=${chatId}`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Cookie": `accessToken=${accessToken}`
            },
            credentials: 'include' // 添加这行确保发送 cookies
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("获取聊天记录长度失败:", error);
        throw error;
    }
}

// 滚动到指定消息
function scrollToMessage(messageId) {
    const messageElement = document.querySelector(`.mes[mesid="${messageId}"]`);
    if (messageElement) {
        messageElement.scrollIntoView({ behavior: "smooth" });
    } else {
        toastr.error("无法跳转到指定楼层：消息未加载或不存在");
    }
}

// 关键词检索
function searchMessages(keyword) {
    const context = getContext();
    const chat = context.chat;
    const settings = extension_settings[extensionName];
    let results = [];

    if (!context.chatId) {
        toastr.error("无法获取当前聊天ID");
        return;
    }

    if (settings.searchScope === "loaded") {
        results = chat.filter((msg, index) => msg.mes.toLowerCase().includes(keyword.toLowerCase())).map(msg => ({
            id: chat.indexOf(msg),
            content: msg.mes
        }));
        if (results.length > 0) {
            scrollToMessage(results[0].id);
            if (settings.highlightKeywords) highlightKeyword(keyword);
        } else {
            toastr.error("关键词检索失败：未找到匹配消息");
        }
    } else {
        getChatLogLength(context.chatId)
            .then(length => {
                return fetchChatLog(context.chatId, 0, length);
            })
            .then(fullChat => {
                // 确保返回的数据格式正确
                if (!Array.isArray(fullChat)) {
                    throw new Error("返回的聊天记录格式不正确");
                }
                
                results = fullChat
                    .filter(msg => msg.content && typeof msg.content === 'string' && 
                                 msg.content.toLowerCase().includes(keyword.toLowerCase()))
                    .map((msg, index) => ({
                        id: index,
                        content: msg.content
                    }));

                if (results.length > 0) {
                    scrollToMessage(results[0].id);
                    if (settings.highlightKeywords) highlightKeyword(keyword);
                } else {
                    toastr.info("未找到匹配的消息");
                }
            })
            .catch(error => {
                console.error("检索失败:", error);
                toastr.error(`关键词检索失败: ${error.message}`);
            });
    }
}

// 高亮关键词
function highlightKeyword(keyword) {
    const messages = document.querySelectorAll(".mes_text");
    messages.forEach(msg => {
        const text = msg.innerHTML;
        const regex = new RegExp(`(${keyword})`, "gi");
        msg.innerHTML = text.replace(regex, '<span style="color: red">$1</span>');
    });
}

// 楼层跳转
function jumpToFloor(floorNumber) {
    const context = getContext();
    const chat = context.chat;
    const floor = parseInt(floorNumber, 10);

    if (isNaN(floor) || floor < 0 || floor >= chat.length) {
        getChatLogLength(context.chatId).then(length => {
            if (floor < length) {
                fetchChatLog(context.chatId, floor, floor + 1).then(() => scrollToMessage(floor));
            } else {
                toastr.error("指定楼层跳转失败：楼层号超出范围");
            }
        });
    } else {
        scrollToMessage(floor);
    }
}

// UI 初始化
jQuery(async () => {
    initSettings();

    const uiHtml = `
        <div id="search-plugin-ui">
            <div class="keyword-search">
                <input type="text" id="search-input" placeholder="输入关键词" />
                <button id="search-action" class="menu_button">${extensionSettings.realTimeRendering ? "清空" : "确定"}</button>
            </div>
            <div class="scroll-buttons">
                <button id="scroll-up" class="menu_button">↑</button>
                <button id="jump-to-floor" class="menu_button">跳转指定楼层</button>
                <button id="scroll-down" class="menu_button">↓</button>
            </div>
            <button id="advanced-settings-btn" class="menu_button">高级检索设置</button>
            <div id="advanced-settings-panel" class="hidden">
                <label>检索方式:</label>
                <input type="radio" name="scope" value="loaded" ${extensionSettings.searchScope === "loaded" ? "checked" : ""}> 只检索加载消息
                <input type="radio" name="scope" value="full" ${extensionSettings.searchScope === "full" ? "checked" : ""}> 检索全文消息
                <label>实时渲染:</label>
                <input type="checkbox" id="real-time" ${extensionSettings.realTimeRendering ? "checked" : ""}>
                <label>关键词提亮:</label>
                <input type="checkbox" id="highlight" ${extensionSettings.highlightKeywords ? "checked" : ""}>
                <button id="save-settings" class="menu_button">保存</button>
            </div>
            <div id="floor-jump-popup" class="hidden">
                <input type="number" id="floor-input" placeholder="输入楼层号" />
                <div id="floor-info"></div>
            </div>
        </div>
    `;
    $("body").append(uiHtml);

    // 关键词检索
    $("#search-input").on("input", () => {
        if (extensionSettings.realTimeRendering) searchMessages($("#search-input").val());
    });
    $("#search-action").on("click", () => {
        if (extensionSettings.realTimeRendering) {
            $("#search-input").val("");
        } else {
            searchMessages($("#search-input").val());
        }
    });

    // 快速滚动
    $("#scroll-up").on("click", () => scrollToMessage(0));
    $("#scroll-down").on("click", () => scrollToMessage(getContext().chat.length - 1));

    // 楼层跳转
    $("#jump-to-floor").on("click", () => $("#floor-jump-popup").toggleClass("hidden"));
    $("#floor-input").on("input", () => {
        const floor = $("#floor-input").val();
        const context = getContext();
        if (floor < context.chat.length) {
            $("#floor-info").text(`楼层 ${floor}: ${context.chat[floor].mes}`);
        } else {
            getChatLogLength(context.chatId).then(length => {
                if (floor < length) {
                    fetchChatLog(context.chatId, floor, floor + 1).then(msg => {
                        $("#floor-info").text(`楼层 ${floor}: ${msg[0].content}`);
                    });
                }
            });
        }
    });
    $("#floor-info").on("click", () => jumpToFloor($("#floor-input").val()));

    // 高级设置
    $("#advanced-settings-btn").on("click", () => $("#advanced-settings-panel").toggleClass("hidden"));
    $("input[name='scope']").on("change", (e) => extensionSettings.searchScope = e.target.value);
    $("#real-time").on("change", (e) => {
        extensionSettings.realTimeRendering = e.target.checked;
        $("#search-action").text(e.target.checked ? "清空" : "确定");
    });
    $("#highlight").on("change", (e) => extensionSettings.highlightKeywords = e.target.checked);
    $("#save-settings").on("click", () => {
        saveSettingsDebounced();
        $("#advanced-settings-panel").addClass("hidden");
    });
});