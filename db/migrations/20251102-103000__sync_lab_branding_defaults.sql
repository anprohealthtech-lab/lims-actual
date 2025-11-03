DO $$
BEGIN
    -- Update set_default_branding_asset to also sync lab default HTML snippets
    EXECUTE $$
    CREATE OR REPLACE FUNCTION set_default_branding_asset(
        p_asset_id UUID,
        p_lab_id UUID,
        p_asset_type VARCHAR
    )
    RETURNS BOOLEAN AS $$
    DECLARE
        v_asset RECORD;
        v_effective_type TEXT;
        v_asset_url TEXT;
        v_asset_name TEXT;
        v_rendered_html TEXT;
    BEGIN
        -- Fetch asset and ensure it belongs to the provided lab
        SELECT
            asset_type,
            COALESCE(NULLIF(file_url, ''), NULLIF(imagekit_url, '')) AS effective_url,
            COALESCE(NULLIF(asset_name, ''), asset_type) AS asset_name
        INTO v_asset
        FROM lab_branding_assets
        WHERE id = p_asset_id
          AND lab_id = p_lab_id
        LIMIT 1;

        IF NOT FOUND THEN
            RETURN FALSE;
        END IF;

        v_effective_type := v_asset.asset_type;

        -- Clear existing defaults of the same type within the lab
        UPDATE lab_branding_assets
        SET is_default = FALSE,
            updated_at = NOW()
        WHERE lab_id = p_lab_id
          AND asset_type = v_effective_type;

        -- Mark the chosen asset as default
        UPDATE lab_branding_assets
        SET is_default = TRUE,
            updated_at = NOW()
        WHERE id = p_asset_id
          AND lab_id = p_lab_id;

        -- When the asset represents a header/footer, persist HTML snippet onto labs table
        IF v_effective_type IN ('header', 'footer') THEN
            v_asset_url := v_asset.effective_url;
            v_asset_name := v_asset.asset_name;

            IF v_asset_url IS NOT NULL THEN
                -- Basic HTML attribute sanitisation
                v_asset_url := replace(replace(v_asset_url, '&', '&amp;'), '"', '&quot;');
                v_asset_name := replace(replace(v_asset_name, '&', '&amp;'), '"', '&quot;');

                v_rendered_html := format(
                    '<div class="lab-%s-branding" style="width:100%%;"><img src="%s" alt="%s" style="max-width:100%%;height:auto;" /></div>',
                    v_effective_type,
                    v_asset_url,
                    v_asset_name
                );
            ELSE
                v_rendered_html := NULL;
            END IF;

            IF v_effective_type = 'header' THEN
                UPDATE labs
                SET default_report_header_html = v_rendered_html,
                    updated_at = NOW()
                WHERE id = p_lab_id;
            ELSE
                UPDATE labs
                SET default_report_footer_html = v_rendered_html,
                    updated_at = NOW()
                WHERE id = p_lab_id;
            END IF;
        END IF;

        RETURN TRUE;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
    $$;
END $$;
