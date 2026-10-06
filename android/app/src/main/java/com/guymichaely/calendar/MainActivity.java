package com.guymichaely.calendar;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RemindersPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
