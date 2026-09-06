import { m } from '$lib/paraglide/messages';

export function analyticsMetricLabel(key: string): string {
	switch (key) {
		case 'views':
		case 'report_views':
			return m.analytics_views();
		case 'impressions':
			return m.analytics_impressions();
		case 'reach':
			return m.analytics_reach();
		case 'likes':
		case 'report_likes':
			return m.analytics_likes();
		case 'reactions':
			return m.analytics_reactions();
		case 'engagements':
			return m.analytics_engagements();
		case 'comments':
		case 'report_comments':
			return m.analytics_comments();
		case 'reposts':
			return m.analytics_reposts();
		case 'quotes':
			return m.analytics_quotes();
		case 'shares':
		case 'report_shares':
			return m.analytics_shares();
		case 'saves':
			return m.analytics_saves();
		case 'clicks':
			return m.analytics_clicks();
		case 'pin_clicks':
			return m.analytics_pin_clicks();
		case 'outbound_clicks':
			return m.analytics_outbound_clicks();
		case 'click_rate':
			return m.analytics_click_rate();
		case 'video_views':
			return m.analytics_video_views();
		case 'estimated_watch_time':
			return m.analytics_watch_time();
		case 'average_view_duration':
			return m.analytics_average_view_duration();
		case 'average_view_percentage':
			return m.analytics_average_view_percentage();
		case 'subscribers_gained':
			return m.analytics_subscribers_gained();
		case 'subscribers_lost':
			return m.analytics_subscribers_lost();
		default:
			return key.replaceAll('_', ' ');
	}
}
