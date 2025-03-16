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

        // 直接使用内存中的聊天记录
        const messages = context.chat;
        console.log('获取到的消息:', messages);
        return messages;
    } catch (error) {
        console.error('获取消息失败:', error);
        throw error;
    }
}

// 滚动到指定消息
function scrollToMessage(messageId) {
    try {
        console.log('尝试滚动到消息:', messageId);
        // 尝试多种选择器
        let messageElement = document.querySelector(`.mes[mesid="${messageId}"]`);
        if (!messageElement) {
            messageElement = document.querySelector(`.mes[data-message-id="${messageId}"]`);
        }
        if (!messageElement) {
            messageElement = document.querySelectorAll('.mes')[messageId];
        }

        if (messageElement) {
            messageElement.scrollIntoView({ behavior: "smooth", block: "center" });
            // 添加临时高亮效果
            messageElement.style.transition = 'background-color 0.5s';
            messageElement.style.backgroundColor = '#ffffd0';
            setTimeout(() => {
                messageElement.style.backgroundColor = '';
            }, 2000);
            console.log('成功滚动到消息');
        } else {
            console.log('消息元素未找到');
            toastr.warning("无法定位到指定消息");
        }
    } catch (error) {
        console.error('滚动到消息时出错:', error);
        toastr.error("滚动到消息时出错");
    }
}

// 关键词检索
function searchMessages(keyword) {
    try {
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

        // 简化搜索逻辑，不再区分loaded和full
        results = chat
            .filter((msg, index) => {
                // 确保消息存在且有内容
                if (!msg || !msg.mes) {
                    console.log(`跳过无效消息 ${index}:`, msg);
                    return false;
                }
                return msg.mes.toLowerCase().includes(keyword.toLowerCase());
            })
            .map((msg, index) => ({
                id: index,
                content: msg.mes
            }));

        console.log('搜索结果:', results);

        if (results.length > 0) {
            scrollToMessage(results[0].id);
            if (settings.highlightKeywords) {
                highlightKeyword(keyword);
            }
        } else {
            toastr.info("未找到匹配的消息");
        }
    } catch (error) {
        console.error("搜索过程中出错:", error);
        toastr.error(`搜索失败: ${error.message}`);
    }
}

// 高亮关键词
function highlightKeyword(keyword) {
    try {
        const messages = document.querySelectorAll(".mes_text");
        messages.forEach(msg => {
            const text = msg.innerHTML;
            // 转义正则表达式特殊字符
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escapedKeyword})`, "gi");
            msg.innerHTML = text.replace(regex, '<span style="background-color: yellow; color: black">$1</span>');
        });
    } catch (error) {
        console.error("高亮关键词时出错:", error);
    }
}

// 楼层跳转
function jumpToFloor(floorNumber) {
    const context = getContext();
    const chat = context.chat;
    const floor = parseInt(floorNumber, 10);

    if (isNaN(floor) || floor < 0 || floor >= chat.length) {
        toastr.error("指定楼层跳转失败：楼层号超出范围");
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
                <button id="search-action" class="menu_button">搜索</button>
            </div>
            <div class="scroll-buttons">
                <button id="scroll-up" class="menu_button">↑</button>
                <button id="jump-to-floor" class="menu_button">跳转指定楼层</button>
                <button id="scroll-down" class="menu_button">↓</button>
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
            toastr.error("指定楼层跳转失败：楼层号超出范围");
        }
    });
    $("#floor-info").on("click", () => jumpToFloor($("#floor-input").val()));
});