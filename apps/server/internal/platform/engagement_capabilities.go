package platform

func (f *FacebookAdapter) EngagementSupport() EngagementSupport {
	return EngagementSupport{
		Enabled:        true,
		RequiredScopes: []string{"pages_read_engagement", "pages_manage_engagement"},
		CanReply:       true,
		CanHide:        true,
		CanDelete:      true,
	}
}

func (i *InstagramAdapter) EngagementSupport() EngagementSupport {
	return EngagementSupport{
		Enabled:        true,
		RequiredScopes: []string{"instagram_manage_comments", "pages_read_engagement"},
		CanReply:       true,
		CanHide:        true,
		CanDelete:      true,
	}
}

func (l *LinkedInAdapter) EngagementSupport() EngagementSupport {
	return EngagementSupport{
		Enabled:   true,
		CanReply:  true,
		CanDelete: true,
		Unavailable: "LinkedIn comment access depends on the connected member or Organization " +
			"application permissions.",
	}
}

func (t *ThreadsAdapter) EngagementSupport() EngagementSupport {
	return EngagementSupport{
		Enabled:        true,
		RequiredScopes: []string{"threads_manage_replies"},
		CanReply:       true,
		CanHide:        true,
	}
}
