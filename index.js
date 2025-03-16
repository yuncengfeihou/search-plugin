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

// 获取当前聊天的消息
async function fetchChatMessages() {
    try {
        console.log('开始获取聊天消息...');
        const context = getContext();
        
        if (!context || !context.chat) {
            throw new Error('无法获取聊天上下文');
        }

        // 使用 SillyTavern 的 API
        const response = await fetch('/api/chats/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: context.chat_id,
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('成功获取消息:', data);
        return data;
    } catch (error) {
        console.error('获取消息失败:', error.message);
        throw error;
    }
}

// 获取聊天记录（支持全文检索）
async function fetchChatLog(chatId, start = 0, end) {
    const url = `/api/shells/chat/getchatlog?chatid=${chatId}&start=${start}${end ? `&end=${end}` : ''}`;
    const response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
    if (!response.ok) throw new Error("获取聊天记录失败");
    return await response.json();
}

// 获取聊天记录总长度
async function getChatLogLength(chatId) {
    const response = await fetch(`/api/shells/chat/getchatloglength?chatid=${chatId}`);
    if (!response.ok) throw new Error("获取聊天记录长度失败");
    return await response.json();
}

// 滚动到指定消息
function scrollToMessage(messageId) {
    try {
        console.log('尝试滚动到消息:', messageId);
        const messageElement = document.querySelector(`.mes[mesid="${messageId}"]`);
        if (messageElement) {
            messageElement.scrollIntoView({ behavior: "smooth" });
            console.log('成功滚动到消息');
        } else {
            console.log('消息元素未找到');
            toastr.warning("无法定位到指定消息，可能需要加载更多历史记录");
        }
    } catch (error) {
        console.error('滚动到消息时出错:', error);
        toastr.error("滚动到消息时出错");
    }
}

// 关键词检索
function searchMessages(keyword) {
    const context = getContext();
    console.log('当前上下文:', context);
    
    if (!context || !context.chat) {
        console.error('无法获取有效的聊天上下文');
        toastr.error("无法获取当前聊天信息");
        return;
    }

    const chat = context.chat;
    const settings = extension_settings[extensionName];
    console.log('当前搜索设置:', settings);
    
    let results = [];

    if (settings.searchScope === "loaded") {
        // 已加载消息的搜索逻辑保持不变
        results = chat.filter((msg, index) => {
            return msg && msg.mes && msg.mes.toLowerCase().includes(keyword.toLowerCase());
        }).map(msg => ({
            id: chat.indexOf(msg),
            content: msg.mes
        }));

        if (results.length > 0) {
            scrollToMessage(results[0].id);
            if (settings.highlightKeywords) highlightKeyword(keyword);
        } else {
            toastr.error("未找到匹配消息");
        }
    } else {
        console.log('开始全文检索...');
        // 使用新的获取消息方法
        fetchChatMessages()
            .then(messages => {
                console.log('获取到的消息:', messages);
                if (!Array.isArray(messages)) {
                    throw new Error("返回的消息格式不正确");
                }

                results = messages
                    .filter(msg => {
                        const content = msg.mes || msg.content || '';
                        return content.toLowerCase().includes(keyword.toLowerCase());
                    })
                    .map((msg, index) => ({
                        id: msg.index || index,
                        content: msg.mes || msg.content
                    }));

                console.log('搜索结果:', results);

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