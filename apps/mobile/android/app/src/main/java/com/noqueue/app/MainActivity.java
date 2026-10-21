package com.noqueue.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NoQueueVaultPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
