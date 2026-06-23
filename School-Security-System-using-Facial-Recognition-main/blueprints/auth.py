from flask import Blueprint, render_template, request, redirect, url_for, session, flash

bp = Blueprint("auth", __name__, url_prefix="/auth")

USERS = {
    "director": {"password": "123", "role": "director", "name": "Директор"},
    "security": {"password": "123", "role": "security", "name": "Охранник"},
    "teacher": {"password": "123", "role": "teacher", "name": "Учитель"}
}

@bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        if username in USERS and USERS[username]["password"] == password:
            session["user"] = USERS[username]
            flash(f"Добро пожаловать, {USERS[username]['name']}!", "ok")
            return redirect(url_for("index"))
        flash("Неверный логин или пароль", "error")
    return render_template("login.html")

@bp.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("auth.login"))