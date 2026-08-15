package com.veritas.ai

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.veritas.ai.auth.AuthManager
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {

    private lateinit var auth: AuthManager
    private lateinit var emailInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var submitButton: Button
    private lateinit var toggleButton: TextView
    private lateinit var errorText: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var logoView: View
    private var isRegisterMode = false
    private var pendingDeepLink: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        auth = AuthManager.getInstance(this)
        pendingDeepLink = intent.getStringExtra("deep_link")
        if (auth.isLoggedIn) { launchMain(); return }
        setContentView(buildUI())
        animateLogo()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun buildUI(): ScrollView {
        val scroll = ScrollView(this)
        scroll.isVerticalScrollBarEnabled = false
        scroll.setBackgroundColor(0xFF0A0F1C.toInt())

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(32), dp(80), dp(32), dp(32))
            gravity = Gravity.CENTER_HORIZONTAL
        }

        logoView = View(this).apply {
            background = createLogoDrawable()
            val lp = LinearLayout.LayoutParams(dp(80), dp(80))
            lp.gravity = Gravity.CENTER_HORIZONTAL
            lp.topMargin = dp(16)
            lp.bottomMargin = dp(8)
            layoutParams = lp
        }

        val titleText = TextView(this).apply {
            text = "VERITAS"
            setTextColor(0xFF50C878.toInt())
            textSize = 28f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.15f
            textAlignment = TextView.TEXT_ALIGNMENT_CENTER
            setPadding(0, dp(12), 0, 0)
        }

        val subtitleText = TextView(this).apply {
            text = "IA con herramientas, memoria, criterio y trazabilidad"
            setTextColor(0xFF64748B.toInt())
            textSize = 12f
            textAlignment = TextView.TEXT_ALIGNMENT_CENTER
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.ITALIC)
            setPadding(0, dp(4), 0, dp(32))
        }

        val emailLabel = TextView(this).apply {
            text = "Email"
            setTextColor(0xFF94A3B8.toInt())
            textSize = 12f
            setPadding(0, dp(8), 0, dp(4))
        }

        emailInput = EditText(this).apply {
            hint = "tu@email.com"
            setHintTextColor(0xFF475569.toInt())
            setTextColor(0xFFE2E8F0.toInt())
            inputType = EditorInfo.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            setBackgroundResource(android.R.drawable.edit_text)
            backgroundTintList = android.content.res.ColorStateList.valueOf(0xFF2A3A5C.toInt())
            setPadding(dp(16), dp(14), dp(16), dp(14))
            setSingleLine(true)
            textSize = 15f
        }

        val passLabel = TextView(this).apply {
            text = "Contrasena"
            setTextColor(0xFF94A3B8.toInt())
            textSize = 12f
            setPadding(0, dp(16), 0, dp(4))
        }

        passwordInput = EditText(this).apply {
            hint = "Minimo 8 caracteres"
            setHintTextColor(0xFF475569.toInt())
            setTextColor(0xFFE2E8F0.toInt())
            inputType = EditorInfo.TYPE_TEXT_VARIATION_PASSWORD
            setBackgroundResource(android.R.drawable.edit_text)
            backgroundTintList = android.content.res.ColorStateList.valueOf(0xFF2A3A5C.toInt())
            setPadding(dp(16), dp(14), dp(16), dp(14))
            setSingleLine(true)
            textSize = 15f
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_DONE) attemptAuth()
                true
            }
        }

        errorText = TextView(this).apply {
            setTextColor(0xFFF87171.toInt())
            textSize = 13f
            setPadding(0, dp(12), 0, 0)
            visibility = View.GONE
        }

        progressBar = ProgressBar(this).apply {
            indeterminateTintList = android.content.res.ColorStateList.valueOf(0xFF50C878.toInt())
            val lp = LinearLayout.LayoutParams(dp(40), dp(40))
            lp.gravity = Gravity.CENTER_HORIZONTAL
            lp.topMargin = dp(8)
            layoutParams = lp
            visibility = View.GONE
        }

        submitButton = Button(this).apply {
            text = "Iniciar sesion"
            setTextColor(0xFF04140D.toInt())
            setBackgroundColor(0xFF50C878.toInt())
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            isAllCaps = false
            letterSpacing = 0.05f
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            )
            lp.topMargin = dp(20)
            layoutParams = lp
            setOnClickListener { attemptAuth() }
        }

        toggleButton = TextView(this).apply {
            text = "No tienes cuenta? Registrate"
            setTextColor(0xFF50C878.toInt())
            textSize = 13f
            textAlignment = TextView.TEXT_ALIGNMENT_CENTER
            setPadding(0, dp(20), 0, 0)
            setOnClickListener { toggleMode() }
        }

        val versionText = TextView(this).apply {
            text = "v2.8.0 — Android"
            setTextColor(0xFF334155.toInt())
            textSize = 11f
            textAlignment = TextView.TEXT_ALIGNMENT_CENTER
            setPadding(0, dp(32), 0, 0)
        }

        for (v in arrayOf(logoView, titleText, subtitleText, emailLabel, emailInput, passLabel, passwordInput, errorText, progressBar, submitButton, toggleButton, versionText)) {
            container.addView(v)
        }
        scroll.addView(container)
        return scroll
    }

    private fun createLogoDrawable(): android.graphics.drawable.GradientDrawable {
        return android.graphics.drawable.GradientDrawable().apply {
            shape = android.graphics.drawable.GradientDrawable.OVAL
            setColor(0xFF50C878.toInt())
        }
    }

    private fun animateLogo() {
        logoView.postDelayed({
            val sx = ObjectAnimator.ofFloat(logoView, "scaleX", 0.8f, 1f).apply { duration = 400 }
            val sy = ObjectAnimator.ofFloat(logoView, "scaleY", 0.8f, 1f).apply { duration = 400 }
            val al = ObjectAnimator.ofFloat(logoView, "alpha", 0f, 1f).apply { duration = 400 }
            AnimatorSet().apply { playTogether(sx, sy, al); start() }
        }, 100)
    }

    private fun toggleMode() {
        isRegisterMode = !isRegisterMode
        submitButton.text = if (isRegisterMode) "Crear cuenta" else "Iniciar sesion"
        toggleButton.text = if (isRegisterMode) "Ya tienes cuenta? Inicia sesion" else "No tienes cuenta? Registrate"
        errorText.visibility = View.GONE
        emailInput.requestFocus()
    }

    private fun attemptAuth() {
        val email = emailInput.text.toString().trim()
        val password = passwordInput.text.toString()
        if (email.isBlank() || !email.contains("@")) { showError("Email invalido"); return }
        if (password.length < 8) { showError("Minimo 8 caracteres"); return }
        setLoading(true)
        lifecycleScope.launch {
            val result = if (isRegisterMode) auth.register(email, password) else auth.login(email, password)
            setLoading(false)
            result.onSuccess { launchMain() }.onFailure { e -> showError(e.message ?: "Error desconocido") }
        }
    }

    private fun showError(msg: String) {
        errorText.text = msg
        errorText.visibility = View.VISIBLE
        ObjectAnimator.ofFloat(errorText, "translationX", -16f, 16f, -8f, 8f, 0f).apply { duration = 400 }.start()
    }

    private fun setLoading(loading: Boolean) {
        submitButton.isEnabled = !loading
        submitButton.alpha = if (loading) 0.5f else 1f
        submitButton.text = if (loading) "Conectando..." else if (isRegisterMode) "Crear cuenta" else "Iniciar sesion"
        progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        errorText.visibility = View.GONE
        if (!loading) passwordInput.text?.clear()
    }

    private fun launchMain() {
        startActivity(Intent(this, MainActivity::class.java).apply {
            pendingDeepLink?.let { putExtra("deep_link", it) }
        })
        finish()
    }
}
