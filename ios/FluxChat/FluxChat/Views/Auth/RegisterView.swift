import SwiftUI

struct RegisterView: View {
    @Environment(AuthState.self) private var authState
    @Binding var showRegister: Bool

    @State private var email = ""
    @State private var username = ""
    @State private var password = ""
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case email, username, password
    }

    // MARK: - Desktop Color Palette

    private let bgPrimary = Color(red: 0.039, green: 0.039, blue: 0.039)       // #0a0a0a
    private let bgSecondary = Color(red: 0.055, green: 0.055, blue: 0.055)     // #0e0e0e
    private let bgInput = Color(red: 0.086, green: 0.086, blue: 0.086)         // #161616
    private let borderColor = Color(red: 0.086, green: 0.086, blue: 0.086)     // #161616
    private let textPrimary = Color(red: 0.91, green: 0.91, blue: 0.91)        // #e8e8e8
    private let textSecondary = Color(red: 0.533, green: 0.533, blue: 0.533)   // #888888
    private let danger = Color(red: 1.0, green: 0.267, blue: 0.267)            // #ff4444

    var body: some View {
        ZStack {
            bgPrimary.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: 80)

                    // Auth Card
                    VStack(spacing: 24) {

                        // Logo
                        FluxLogoView(size: 40)
                            .foregroundStyle(.white)

                        // Title & Subtitle
                        VStack(spacing: 8) {
                            Text("Create your account")
                                .font(.system(size: 24, weight: .bold))
                                .foregroundStyle(textPrimary)

                            Text("Join Flux to get started")
                                .font(.system(size: 14))
                                .foregroundStyle(textSecondary)
                        }

                        // Error Banner
                        if let error = authState.error {
                            HStack(spacing: 8) {
                                Image(systemName: "exclamationmark.circle.fill")
                                    .font(.system(size: 13))
                                Text(error)
                                    .font(.system(size: 13))
                                    .multilineTextAlignment(.leading)
                            }
                            .foregroundStyle(danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(Color(red: 0.906, green: 0.298, blue: 0.235).opacity(0.15))
                            )
                        }

                        // Form Fields
                        VStack(spacing: 16) {
                            // Email Field
                            VStack(alignment: .leading, spacing: 6) {
                                Text("EMAIL")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(textSecondary)
                                    .tracking(0.5)

                                TextField("", text: $email)
                                    .textContentType(.emailAddress)
                                    .keyboardType(.emailAddress)
                                    .autocorrectionDisabled()
                                    .textInputAutocapitalization(.never)
                                    .font(.system(size: 14))
                                    .foregroundStyle(textPrimary)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 10)
                                    .background(bgInput)
                                    .clipShape(RoundedRectangle(cornerRadius: 18))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 18)
                                            .stroke(
                                                focusedField == .email ? .white : borderColor,
                                                lineWidth: 1
                                            )
                                    )
                                    .focused($focusedField, equals: .email)
                            }

                            // Username Field
                            VStack(alignment: .leading, spacing: 6) {
                                Text("USERNAME")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(textSecondary)
                                    .tracking(0.5)

                                TextField("", text: $username)
                                    .textContentType(.username)
                                    .autocorrectionDisabled()
                                    .textInputAutocapitalization(.never)
                                    .font(.system(size: 14))
                                    .foregroundStyle(textPrimary)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 10)
                                    .background(bgInput)
                                    .clipShape(RoundedRectangle(cornerRadius: 18))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 18)
                                            .stroke(
                                                focusedField == .username ? .white : borderColor,
                                                lineWidth: 1
                                            )
                                    )
                                    .focused($focusedField, equals: .username)
                            }

                            // Password Field
                            VStack(alignment: .leading, spacing: 6) {
                                Text("PASSWORD")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(textSecondary)
                                    .tracking(0.5)

                                SecureField("", text: $password)
                                    .textContentType(.newPassword)
                                    .font(.system(size: 14))
                                    .foregroundStyle(textPrimary)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 10)
                                    .background(bgInput)
                                    .clipShape(RoundedRectangle(cornerRadius: 18))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 18)
                                            .stroke(
                                                focusedField == .password ? .white : borderColor,
                                                lineWidth: 1
                                            )
                                    )
                                    .focused($focusedField, equals: .password)
                            }
                        }

                        // Create Account Button
                        Button {
                            focusedField = nil
                            Task {
                                await authState.signUp(
                                    email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                                    password: password,
                                    username: username.trimmingCharacters(in: .whitespacesAndNewlines)
                                )
                            }
                        } label: {
                            Group {
                                if authState.isLoading {
                                    ProgressView()
                                        .tint(.black)
                                } else {
                                    Text("Create Account")
                                        .font(.system(size: 15, weight: .semibold))
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .background(.white)
                            .foregroundStyle(.black)
                            .clipShape(RoundedRectangle(cornerRadius: 18))
                        }
                        .disabled(formIncomplete || authState.isLoading)
                        .opacity(formIncomplete ? 0.5 : 1.0)
                    }
                    .padding(40)
                    .background(
                        RoundedRectangle(cornerRadius: 18)
                            .fill(bgSecondary.opacity(0.9))
                            .background(
                                RoundedRectangle(cornerRadius: 18)
                                    .fill(.ultraThinMaterial)
                            )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 18)
                            .stroke(borderColor, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    .padding(.horizontal, 24)

                    // Footer Link
                    Spacer().frame(height: 24)

                    Button {
                        showRegister = false
                    } label: {
                        HStack(spacing: 4) {
                            Text("Already have an account?")
                                .foregroundStyle(textSecondary)
                            Text("Sign In")
                                .foregroundStyle(.white)
                                .fontWeight(.medium)
                        }
                        .font(.system(size: 14))
                    }

                    Spacer()
                }
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .preferredColorScheme(.dark)
    }

    private var formIncomplete: Bool {
        email.isEmpty || username.isEmpty || password.isEmpty
    }
}

#Preview {
    RegisterView(showRegister: .constant(true))
        .environment(AuthState())
}
