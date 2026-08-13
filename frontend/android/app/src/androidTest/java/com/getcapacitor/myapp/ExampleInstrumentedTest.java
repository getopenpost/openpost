package com.openpost.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {
    @Test
    public void packageAndOidcCallbackResolveToThePublishedApplication() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.openpost.app", appContext.getPackageName());

        Intent callback = new Intent(
            Intent.ACTION_VIEW,
            Uri.parse("openpost://oidc/callback?code=test&state=test")
        );
        callback.setPackage(appContext.getPackageName());
        PackageManager packageManager = appContext.getPackageManager();
        assertNotNull(packageManager.resolveActivity(callback, PackageManager.MATCH_DEFAULT_ONLY));
    }
}
