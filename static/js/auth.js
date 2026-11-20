// Authentication and password management
  async function checkAuth() {
    const res = await fetch("/api/auth/status");
    const data = await res.json();
    if (!data.logged_in) {
      document.getElementById("loginOverlay").style.display = "flex";
    } else {
      document.getElementById("loginOverlay").style.display = "none";
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    const password = document.getElementById("loginPasswordInput").value;
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });

    if (res.ok) {
      document.getElementById("loginOverlay").style.display = "none";
      document.getElementById("loginPasswordInput").value = "";
      document.getElementById("loginError").style.display = "none";
      loadWinConditions();
      loadCommanders();
      loadStats();
    } else {
      const err = await res.json();
      const errDiv = document.getElementById("loginError");
      errDiv.textContent = err.error || "Onjuist wachtwoord";
      errDiv.style.display = "block";
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.reload();
  }

  async function changePassword() {
    const current_password = document.getElementById("currentPassword").value;
    const new_password = document.getElementById("newPassword").value;

    const res = await fetch("/api/auth/change_password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password, new_password })
    });

    if (res.ok) {
      document.getElementById("currentPassword").value = "";
      document.getElementById("newPassword").value = "";
      showToast("Wachtwoord succesvol gewijzigd!");
    } else {
      const err = await res.json();
      showToast(err.error || "Fout bij wijzigen wachtwoord", true);
    }
  }

