package com.openpost.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class ExampleUnitTest {
    @Test
    public void applicationIdMatchesPublishedPackage() {
        assertEquals("com.openpost.app", BuildConfig.APPLICATION_ID);
    }
}
