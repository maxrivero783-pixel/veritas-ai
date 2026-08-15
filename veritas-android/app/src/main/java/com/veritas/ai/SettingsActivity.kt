package com.veritas.ai

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.webkit.WebStorage
import android.webkit.CookieManager
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.veritas.ai.auth.AuthManager
import kotlinx.coroutines.launch

/**
 * Native settings / profile screen for Veritas AI.
 *
 * Sections:
 *  - Profile (email, read-only)
 *  - Change password
 *  - Cache management (clear WebView data)
 *  - App info (version, build)
 *  - Log out
 */
class SettingsActivity : AppCompatActivity() {

    private lateinit var auth: AuthManager
    private lateinit var container: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        auth = AuthManager.getInstance(this)

        // Status bar color
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
 window.setDecorFitsSystemWindows(false)
        }

        val scroll = ScrollView(this)
        scroll.isVerticalScrollBarEnabled = false
        scroll.setBackgroundColor(0xFF0A0F1C.toInt())

        container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(60), dp(24), dp(32))
        }

        scroll.addView(container)
        setContentView(scroll)

        buildUI()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun buildUI() {
        // Header
        container.addView(buildHeader())
        container.addView(buildDivider())

        // Profile section
        container.addView(sectionLabel("Perfil"))
        container.addView(buildProfileCard())
        container.addView(verticalSpace(12))

        // Security section
        container.addView(sectionLabel("Seguridad"))
        container.addView(buildChangePasswordRow())
        container.addView(verticalSpace(12))

        // Data section
        container.addView(sectionLabel("Datos"))
        container.addView(buildClearCacheRow())
        container.addView(verticalSpace(12))

        // About section
        container.addView(sectionLabel("Acerca de"))
        container.addView(buildAboutCard())
        container.addView(verticalSpace(24))

        // Logout button
        container.addView(buildLogoutButton())
    }

    private fun buildDivider(): View {
        return View(this).apply {
            setBackgroundColor(0xFF1E293B.toInt())
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 1
            ).apply { topMargin = dp(8); bottomMargin = dp(8) }
        }
    }

    // --- Header ---

    private fun buildHeader(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, dp(16))

            val backBtn = ImageButton(this@SettingsActivity).apply {
                setImageResource(android.R.drawable.ic_menu_revert)
                setColorFilter(0xFF50C878.toInt())
                setBackgroundColor(0x00000000.toInt())
                setPadding(dp(8), dp(8), dp(8), dp(8))
                layoutParams = LinearLayout.LayoutParams(dp(40), dp(40))
                setOnClickListener { onBackPressed() }
            }

            val title = TextView(this@SettingsActivity).apply {
                text = "Ajustes"
                setTextColor(0xFFE2E8F0.toInt())
                textSize = 20f
                typeface = Typeface.DEFAULT_BOLD
                setPadding(dp(12), 0, 0, 0)
            }

            addView(backBtn)
            addView(title)
        }
    }

    // --- Profile card ---

    private fun buildProfileCard(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF111827.toInt())
            setPadding(dp(16), dp(16), dp(16), dp(16))
            radius(dp(12))

            val emailLabel = TextView(this@SettingsActivity).apply {
                text = "Email"
                setTextColor(0xFF64748B.toInt())
                textSize = 11f
            }

            val emailValue = TextView(this@SettingsActivity).apply {
                text = auth.currentUserEmail ?: "No autenticado"
                setTextColor(0xFFE2E8F0.toInt())
                textSize = 15f
                typeface = Typeface.DEFAULT_BOLD
                setPadding(0, dp(4), 0, 0)
            }

            addView(emailLabel)
            addView(emailValue)
        }
    }

    // --- Change password ---

    private fun buildChangePasswordRow(): LinearLayout {
        return clickableRow("Cambiar contrasena", "Actualizar tu contrasena de acceso") {
            showChangePasswordDialog()
        }
    }

    private fun showChangePasswordDialog() {
        val dialogView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(20), dp(24), dp(8))
        }

        val currentInput = EditText(this).apply {
            hint = "Contrasena actual"
            setHintTextColor(0xFF475569.toInt())
            setTextColor(0xFFE2E8F0.toInt())
            inputType = EditorInfo.TYPE_TEXT_VARIATION_PASSWORD
            setBackgroundResource(android.R.drawable.edit_text)
            backgroundTintList = android.content.res.ColorStateList.valueOf(0xFF2A3A5C.toInt())
            setPadding(dp(16), dp(12), dp(16), dp(12))
            setSingleLine()
        }

        val newInput = EditText(this).apply {
            hint = "Nueva contrasena (min 8)"
            setHintTextColor(0xFF475569.toInt())
            setTextColor(0xFFE2E8F0.toInt())
            inputType = EditorInfo.TYPE_TEXT_VARIATION_PASSWORD
            setBackgroundResource(android.R.drawable.edit_text)
            backgroundTintList = android.content.res.ColorStateList.valueOf(0xFF2A3A5C.toInt())
            setPadding(dp(16), dp(12), dp(16), dp(12))
            setSingleLine()
            setPadding(0, dp(12), 0, 0)
        }

        dialogView.addView(currentInput)
        dialogView.addView(newInput)

        AlertDialog.Builder(this)
            .setTitle("Cambiar contrasena")
            .setView(dialogView)
            .setPositiveButton("Actualizar") { _, _ ->
                val current = currentInput.text.toString()
                val newPass = newInput.text.toString()
                if (newPass.length < 8) {
                    Toast.makeText(this, "Minimo 8 caracteres", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                lifecycleScope.launch {
                    val result = auth.changePassword(current, newPass)
                    result.onSuccess {
                        Toast.makeText(this@SettingsActivity, "Contrasena actualizada", Toast.LENGTH_SHORT).show()
                    }.onFailure { e ->
                        Toast.makeText(this@SettingsActivity, e.message ?: "Error", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    // --- Clear cache ---

    private fun buildClearCacheRow(): LinearLayout {
        return clickableRow("Limpiar cache", "Borrar datos de navegacion y cache") {
            showClearCacheConfirm()
        }
    }

    private fun showClearCacheConfirm() {
        AlertDialog.Builder(this)
            .setTitle("Limpiar cache")
            .setMessage("Se borraran cookies, cache y datos de sitios. Tu sesion se mantendra.")
            .setPositiveButton("Limpiar") { _, _ ->
                WebStorage.getInstance().deleteAllData()
                CookieManager.getInstance().removeAllCookies(null)
                Toast.makeText(this, "Cache limpiado", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    // --- About card ---

    private fun buildAboutCard(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF111827.toInt())
            setPadding(dp(16), dp(16), dp(16), dp(16))
            radius(dp(12))

            val items = listOf(
                "Version" to "2.8.0 (build 3)",
                "Plataforma" to "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
                "Paquete" to "com.veritas.ai",
                "Backend" to "Cloudflare Workers + D1"
            )

            for ((label, value) in items) {
                val row = LinearLayout(this@SettingsActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(0, dp(6), 0, dp(6))
                }

                row.addView(TextView(this@SettingsActivity).apply {
                    text = label
                    setTextColor(0xFF64748B.toInt())
                    textSize = 13f
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })

                row.addView(TextView(this@SettingsActivity).apply {
                    text = value
                    setTextColor(0xFF94A3B8.toInt())
                    textSize = 13f
                })

                addView(row)
            }
        }
    }

    // --- Logout ---

    private fun buildLogoutButton(): Button {
        return Button(this).apply {
            text = "Cerrar sesion"
            setTextColor(0xFFF87171.toInt())
            setBackgroundColor(0x00000000.toInt())
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            isAllCaps = false
            setPadding(0, dp(16), 0, dp(16))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            )
            setOnClickListener { confirmLogout() }
        }
    }

    private fun confirmLogout() {
        AlertDialog.Builder(this)
            .setTitle("Cerrar sesion")
            .setMessage("Se cerrara tu sesion en este dispositivo.")
            .setPositiveButton("Cerrar sesion") { _, _ ->
                lifecycleScope.launch {
                    auth.logout()
                    startActivity(Intent(this@SettingsActivity, LoginActivity::class.java))
                    finishAffinity()
                }
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    // --- Helpers ---

    private fun sectionLabel(text: String): TextView {
        return TextView(this).apply {
            this.text = text.uppercase()
            setTextColor(0xFF50C878.toInt())
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.1f
            setPadding(0, dp(12), 0, dp(8))
        }
    }

    private fun clickableRow(title: String, subtitle: String, onClick: () -> Unit): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(0xFF111827.toInt())
            setPadding(dp(16), dp(14), dp(16), dp(14))
            radius(dp(12))
            isClickable = true
            setOnClickListener { onClick() }

            val textCol = LinearLayout(this@SettingsActivity).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            textCol.addView(TextView(this@SettingsActivity).apply {
                this.text = title
                setTextColor(0xFFE2E8F0.toInt())
                textSize = 15f
            })

            textCol.addView(TextView(this@SettingsActivity).apply {
                this.text = subtitle
                setTextColor(0xFF64748B.toInt())
                textSize = 12f
                setPadding(0, dp(2), 0, 0)
            })

            addView(textCol)

            addView(TextView(this@SettingsActivity).apply {
                text = ">"
                setTextColor(0xFF475569.toInt())
                textSize = 18f
            })
        }
    }

    private fun verticalSpace(dp: Int): View {
        return View(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, this@SettingsActivity.dp(dp)
            )
        }
    }

    private fun View.radius(dp: Int) {
        background = android.graphics.drawable.GradientDrawable().apply {
            setColor(background?.let { (it as? android.graphics.drawable.GradientDrawable)?.color?.defaultColor } ?: 0xFF111827.toInt())
            setCornerRadius(this@SettingsActivity.dp(dp).toFloat())
        }
    }

    override fun onBackPressed() {
        super.onBackPressed()
        overridePendingTransition(android.R.anim.slide_in_left, android.R.anim.slide_out_right)
    }
}