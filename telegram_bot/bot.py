"""
Afreim Banya Bot - Fixed navigation
"""

import os
import logging
from telegram import Update, WebAppInfo, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, CallbackQueryHandler, ContextTypes
)

BOT_TOKEN = os.getenv("BOT_TOKEN", "8625296525:AAGpvAUNIQvZRP1ZwaS5JNPOQyibziFRg6s")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://afreim-calendar.onrender.com")

logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO)

# ============== TEXT CONTENT ==============

WELCOME = "🏠 *Афрейм Баня*\n\nУединённый отдых в тишине природы\n\nВыберите раздел:"

ABOUT = """🏠 *О нас*

Добро пожаловать в Афрейм Баню Ленск
Уютный отдых на природе: баня + банный чан

📍 Лениногорск, ул. Зелёная, 8
👥 До 6 гостей"""

PRICING = """💰 *Стоимость*

*Будни (Вс–Чт)*
━━━━━━━━━━━━━━
2 чел — 6 000 ₽
4 чел — 7 000 ₽
6 чел — 8 000 ₽

*Выходные (Пт–Сб)*
━━━━━━━━━━━━━━
2 чел — 8 000 ₽
4 чел — 9 000 ₽
6 чел — 10 000 ₽

*Дополнительно*
━━━━━━━━━━━━━━
Баня: 2 часа бесплатно, далее +300 ₽/час

Чан:
4000 ₽ — без украшения
4500 ₽ — ваше оформление
5000 ₽ — оформление от нас

Веники: 350 ₽ (дубовый)
Берёзовые — запрещены"""

INCLUDED = """🛁 *Что входит*

• кухня
• посуда (на 6 персон)
• тёплые полы
• ТВ
• Wi-Fi
• колонка
• мангальная зона
• беседка"""

CAPACITY = """📏 *Вместимость*

👥 Максимум: до 6 гостей (дневное пребывание)

🛏 Спальные места: до 4 человек
— двуспальная кровать
— двуспальный диван

🍽 Посуда: на 6 человек"""

RULES = """📜 *Правила*

• без животных
• не курить в доме
• тишина на территории после 22:00

Мангальная зона:
оставляется в чистом виде
или удержание 300 ₽ за уборку"""

BOOKING_WARNING = """📅 *Бронирование*

⚠️ Перед бронированием ознакомьтесь с условиями.

Нажимая «Подтвердить», вы соглашаетесь:
— с условиями бронирования
— с правилами проживания
— с условиями страхового депозита"""

BOOKING_AFTER_CONFIRM = """📅 *Бронирование*

Контакты администратора:

Telegram: @mustafini
Телефон: +7 987 009-2808

Для бронирования напишите или позвоните."""

TERMS = """📜 *Условия страхового депозита*

При заселении вносится страховой депозит.

*Депозит возвращается при условии:*
— соблюдения правил проживания
— отсутствия повреждений имущества
— передачи дома и мангальной зоны в чистом состоянии

*При нарушениях, ущербе или дополнительной уборке* — удержание из депозита по фактическим затратам.

Оценка состояния производится администратором.

Факт бронирования и получения контактов означает согласие с данными условиями."""

# ============== KEYBOARDS ==============

def get_main_kb():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton("🏠 О нас", callback_data="about")],
        [InlineKeyboardButton("💰 Стоимость", callback_data="pricing")],
        [InlineKeyboardButton("🛁 Что входит", callback_data="included")],
        [InlineKeyboardButton("📏 Вместимость", callback_data="capacity")],
        [InlineKeyboardButton("📜 Правила", callback_data="rules")],
        [InlineKeyboardButton("📅 Бронирование", callback_data="booking")],
    ])

def get_back_kb():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton("🔙 Назад в меню", callback_data="back")]
    ])

def get_booking_kb():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton("✅ Подтвердить и продолжить", callback_data="booking_confirm")],
        [InlineKeyboardButton("📜 Условия", callback_data="terms")],
        [InlineKeyboardButton("🔙 Назад в меню", callback_data="back")]
    ])

def get_contact_url_kb():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton("💬 Telegram", url="https://t.me/mustafini")],
        [InlineKeyboardButton("🔙 Назад в меню", callback_data="back")]
    ])

def get_terms_kb():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton("✅ Подтвердить и продолжить", callback_data="booking_confirm")],
        [InlineKeyboardButton("🔙 Назад", callback_data="booking")]
    ])

# ============== HANDLERS ==============

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(WELCOME, reply_markup=get_main_kb(), parse_mode="Markdown")

async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    
    data = query.data
    print(f"Callback: {data}")
    
    if data == "back":
        await query.edit_message_text(text=WELCOME, reply_markup=get_main_kb(), parse_mode="Markdown")
    
    elif data == "about":
        await query.edit_message_text(text=ABOUT, reply_markup=get_back_kb(), parse_mode="Markdown")
    
    elif data == "pricing":
        await query.edit_message_text(text=PRICING, reply_markup=get_back_kb(), parse_mode="Markdown")
    
    elif data == "included":
        await query.edit_message_text(text=INCLUDED, reply_markup=get_back_kb(), parse_mode="Markdown")
    
    elif data == "capacity":
        await query.edit_message_text(text=CAPACITY, reply_markup=get_back_kb(), parse_mode="Markdown")
    
    elif data == "rules":
        await query.edit_message_text(text=RULES, reply_markup=get_back_kb(), parse_mode="Markdown")
    
    elif data == "booking":
        await query.edit_message_text(text=BOOKING_WARNING, reply_markup=get_booking_kb(), parse_mode="Markdown")
    
    elif data == "terms":
        await query.edit_message_text(text=TERMS, reply_markup=get_terms_kb(), parse_mode="Markdown")
    
    elif data == "booking_confirm":
        await query.message.reply_text(BOOKING_AFTER_CONFIRM, reply_markup=get_contact_url_kb(), parse_mode="Markdown")
        await query.message.delete()
        await query.answer("Контакты отправлены!")

async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("*Команды:*\n/start — Меню", parse_mode="Markdown")

def main():
    print(f"Starting bot... WEBAPP_URL: {WEBAPP_URL}")
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("menu", start))
    app.add_handler(CommandHandler("help", help_cmd))
    app.add_handler(CallbackQueryHandler(callback_handler))
    print("Bot running...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
