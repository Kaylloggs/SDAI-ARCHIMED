package {{package}};

import {{package}}.registry.ModBlocks;
import {{package}}.registry.ModItems;
import net.fabricmc.api.ModInitializer;
import net.minecraft.util.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class {{main_class}} implements ModInitializer {
	public static final String MOD_ID = "{{mod_id}}";
	public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

	/** Identifier in this mod's namespace. */
	public static Identifier id(String path) {
		return {{identifier_expr}};
	}

	@Override
	public void onInitialize() {
		ModBlocks.init();
		ModItems.init();
		LOGGER.info("Initialized {}", MOD_ID);
	}
}
