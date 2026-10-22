package com.noqueue.app;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileNotFoundException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** AES-GCM with a non-exportable Keystore key; encrypted data excluded from backups. */
@CapacitorPlugin(name = "NoQueueVault")
public class NoQueueVaultPlugin extends Plugin {
    private static final String ALIAS = "noqueue.installation.v1";
    private AtomicFile file() {
        return new AtomicFile(new File(getContext().getNoBackupFilesDir(), "noqueue-installation.v1"));
    }
    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            if (!create) throw new IllegalStateException("Missing installation key");
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    @PluginMethod
    public synchronized void read(PluginCall call) {
        try {
            AtomicFile file = file();
            byte[] data;
            try {
                // readFully/openRead restores AtomicFile's .bak after an
                // interrupted write on older Android versions. Do not test
                // baseFile.exists() first and accidentally replace an identity.
                data = file.readFully();
            } catch (FileNotFoundException missing) {
                if (file.getBaseFile().exists() || new File(file.getBaseFile() + ".bak").exists()) throw missing;
                call.resolve(new JSObject().put("value", JSONObject.NULL));
                return;
            }
            if (data.length < 28 || data.length > 65564) throw new IllegalStateException("Invalid vault");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, Arrays.copyOfRange(data, 0, 12)));
            cipher.updateAAD(ALIAS.getBytes(StandardCharsets.UTF_8));
            String value = new String(cipher.doFinal(Arrays.copyOfRange(data, 12, data.length)), StandardCharsets.UTF_8);
            call.resolve(new JSObject().put("value", value));
        } catch (Exception error) {
            call.reject("Secure installation storage is unavailable");
        }
    }
    @PluginMethod
    public synchronized void write(PluginCall call) {
        FileOutputStream stream = null;
        AtomicFile file = file();
        try {
            String value = call.getString("value");
            if (value == null || value.getBytes(StandardCharsets.UTF_8).length > 65536)
                throw new IllegalArgumentException("Invalid vault value");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key(true));
            cipher.updateAAD(ALIAS.getBytes(StandardCharsets.UTF_8));
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            stream = file.startWrite();
            stream.write(cipher.getIV());
            stream.write(encrypted);
            file.finishWrite(stream);
            call.resolve();
        } catch (Exception error) {
            if (stream != null) file.failWrite(stream);
            call.reject("Could not save secure installation");
        }
    }
}
